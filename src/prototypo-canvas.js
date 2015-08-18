var prototypo = require('prototypo.js'),
	assign = require('es6-object-assign').assign,
	// Grid = require('./grid'),
	glyph = require('./utils/glyph'),
	mouseHandlers = require('./utils/mouseHandlers'),
	workerHandlers = require('./utils/workerHandlers'),
	init = require('./utils/init'),
	loadFont = require('./utils/loadFont');

var _ = { assign: assign },
	paper = prototypo.paper;

// constructor
function PrototypoCanvas( opts ) {
	paper.setup( opts.canvas );
	// enable pointerevents on the canvas
	opts.canvas.setAttribute('touch-action', 'none');

	this.opts = _.assign({
		fill: true,
		shoNodes: false,
		zoomFactor: 0.05,
		jQueryListeners: true
	}, opts);

	this.canvas = opts.canvas;
	this.view = paper.view;
	this.view.center = [ 0, 0 ];
	this.project = paper.project;
	this.project.activeLayer.applyMatrix = false;
	this.project.activeLayer.scale( 1, -1 );
	this.worker = opts.worker;
	this._queue = [];
	this._fill = this.opts.fill;
	this._showNodes = this.opts.showNodes;
	this.fontsMap = {};
	this.isMousedown = false;

	// this.grid = new Grid( paper );

	// bind workerHandlers
	if ( this.worker ) {
		this.worker.addEventListener('message', function(e) {
			// the job might have been cancelled
			if ( !this.currentJob ) {
				return;
			}

			// execute the appropriate handler, according to the type of the
			// current job.
			var result = this[ this.currentJob.type + 'Handler' ](e);

			if ( this.currentJob.callback ) {
				this.currentJob.callback( result );
			}

			this.currentJob = false;
			this.dequeue();

		}.bind(this));
	}

	// bind mouseHandlers (jQuery is an optional dependency)
	if ( ( 'jQuery' in window ) && this.opts.jQueryListeners ) {
		var $ = window.jQuery,
			type = ( 'PointerEventsPolyfill' in window ) ||
				( 'PointerEvent' in window ) ? 'pointer' : 'mouse';

		$(opts.canvas).on( 'wheel', this.wheelHandler.bind(this) );

		$(opts.canvas).on( type + 'move', this.moveHandler.bind(this) );

		$(opts.canvas).on( type + 'down', this.downHandler.bind(this) );

		$(document).on( type + 'up', this.upHandler.bind(this) );
	}

	// setup raf loop
	var raf = window.requestAnimationFrame ||
			window.webkitRequestAnimationFrame,
		updateLoop = function() {
			raf(updateLoop);

			if ( !this.latestRafValues || !this.currGlyph ) {
				return;
			}

			this.font.update( this.latestRafValues, [ this.currGlyph ] );
			this.view.update();
			delete this.latestRafValues;

		}.bind(this);
	updateLoop();
}

PrototypoCanvas.init = init;
PrototypoCanvas.prototype.loadFont = loadFont;
_.assign( PrototypoCanvas.prototype, mouseHandlers, workerHandlers );

Object.defineProperties( PrototypoCanvas.prototype, {
	zoom: {
		get: function() {
			return this.view.zoom;
		},
		set: function( zoom ) {
			this.view.zoom = zoom;
			// this.grid.zoom = zoom;
		}
	},
	fill: {
		get: function() {
			return this._fill;
		},
		set: function( bool ) {
			this._fill = bool;
			this.displayGlyph();
		}
	},
	showNodes: {
		get: function() {
			return this._showNodes;
		},
		set: function( bool ) {
			this._showNodes = bool;
			this.displayGlyph();
		}
	},
	showCoords: {
		get: function() {
			return paper.settings.drawCoords;
		},
		set: function( bool ) {
			paper.settings.drawCoords = bool;
			this.displayGlyph();
		}
	},
	subset: {
		get: function() {
			return this.font.subset;
		},
		set: function( set ) {
			this.enqueue({
				type: 'subset',
				data: set
			});

			this.font.subset = this.currSubset = set;
		}
	}
});

PrototypoCanvas.prototype.displayGlyph = glyph.displayGlyph;

PrototypoCanvas.prototype.displayChar = function( code ) {
	this.latestChar = code;
	this.displayGlyph( typeof code === 'string' ?
		this.font.charMap[ code.charCodeAt(0) ] : code
	);
};

// overwrite the appearance of #selected items in paper.js
paper.PaperScope.prototype.Path.prototype._drawSelected = glyph._drawSelected;
_.assign( paper.settings, {
	handleSize: 6,
	handleColor: '#FF725E',
	nodeColor: '#00C4D6',
	drawCoords: false,
	handleFont: '12px monospace'
});

// The worker queue is not your ordinary queue: the priority of the job is
// defined arbitrarily, and any message previously present
// at this position will be overwritten. The priorities associated to the
// message type are hardcoded below (in ascending priority order).
PrototypoCanvas.priorities = [ 'update', 'subset', 'svgFont', 'otfFont' ];
PrototypoCanvas.prototype.enqueue = function( message ) {
	this._queue[ PrototypoCanvas.priorities.indexOf( message.type ) ] = message;
	this.dequeue();
};

PrototypoCanvas.prototype.dequeue = function() {
	if ( this.currentJob || !this.worker ) {
		return;
	}

	// send the highest priority mesage in the queue (0 is lowest)
	for ( var i = this._queue.length; i--; ) {
		if ( this._queue[i] ) {
			this.currentJob = this._queue[i];
			this.worker.postMessage( this.currentJob );
			this._queue[i] = null;
			break;
		}
	}
};

PrototypoCanvas.prototype.emptyQueue = function() {
	this._queue = [];
	this.currentJob = false;
};

PrototypoCanvas.prototype.update = function( values ) {
	// latestValues are used in displayGlyph
	// latestWorkerValues is used and disposed by th/sue fontBufferHandler
	// latestRafValues is used and disposed by the raf loop
	// so we need all three!
	this.latestValues = this.latestRafValues = values;

	this.enqueue({
		type: 'update',
		data: values
	});
};

PrototypoCanvas.prototype.download = function( cb, name ) {
	if ( !this.worker || !this.latestValues ) {
		// the UI should wait for the first update to happen before allowing
		// the download button to be clicked
		return false;
	}

	this.enqueue({
		type: 'otfFont',
		data: name,
		callback: cb
	});
};

PrototypoCanvas.prototype.openInGlyphr = function( cb ) {
	if ( !this.worker || !this.latestValues ) {
		// the UI should wait for the first update to happen before allowing
		// the download button to be clicked
		return false;
	}

	this.enqueue({
		type: 'svgFont',
		callback: cb
	});
};

// PrototypoCanvas.prototype.changeFont = function( opts ) {
// 	return changeFont( opts );
// };
//
// PrototypoCanvas.prototype.loadFont = function( opts ) {
// 	this.worker.onmessage = fontBufferHandler.bind(this);
// 	if ( this.fontRegister[opts.fontObj.fontinfo.familyName] ) {
// 		this.font = this.fontRegister[opts.fontObj.fontinfo.familyName];
// 	} else {
// 		this.font = prototypo.parametricFont( opts.fontObj );
// 		this.fontRegister[opts.fontObj.fontinfo.familyName] = this.font;
// 	}
//
// 	// Ok I think I know how it works now.
// // getGlyphSubset returns a whole subset when you call update in the worker
// 	// (don't know why though).
// 	// So if the font is not complete when you call update the font is
// 	// incomplete and cannot be loaded with window.FontFace.
// 	// When you load an incomplete font you have to call the subset getter to
// 	// load the font properly.
// 	// displayChar is called to update the whole glyph in canvas.
// 	this.update( this.latestValues, this.subset );
// 	this.subset = this.saveSubset;
// 	this.displayChar( this.latestChar );
// };

module.exports = PrototypoCanvas;
