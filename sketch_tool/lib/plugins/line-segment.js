import z from 'sketch2/util/zdom';
import BasePlugin from './base-plugin';
import { injectStyleSheet, injectSVGDefs } from 'sketch2/util/dom-style-helpers';

export const VERSION = '0.1';
export const GRADEABLE_VERSION = '0.1';

export default class LineSegment extends BasePlugin {

  constructor(params, app) {
    let iconSrc;
    // Add params that are specific to this plugin
    if (params.arrowHead) {
      let length = params.arrowHead.length,
          base = params.arrowHead.base,
          refY = base/2;
      injectSVGDefs(`
        <marker id="arrowhead-${params.id}" markerWidth="${length}" markerHeight="${base}" refX="${length}" refY="${refY}" orient="auto">
          <polygon points="0 0, ${length} ${refY}, 0 ${base}" style="fill: ${params.color}; stroke: ${params.color}; stroke-width: 1;"/>
        </marker>`
      );
      iconSrc = './plugins/line-segment/arrow-icon.svg';
    }
    else {
      iconSrc = './plugins/line-segment/line-icon.svg';
    }
    params.icon = {
      src: iconSrc,
      alt: 'Line segment tool',
      color: params.color
    };
    super(params, app);
    // Message listeners
    this.app.__messageBus.on('addLineSegment', (id, index) => {this.addLineSegment(id, index)});
    this.app.__messageBus.on('addLineSegmentPoint', (id, index) => {this.addLineSegmentPoint(id, index)});
    this.app.__messageBus.on('deleteLineSegments', () => {this.deleteLineSegments()});
    this.app.__messageBus.on('deleteLineSegmentPoints', () => {this.deleteLineSegmentPoints()});
    this.hConstraint = false;
    this.vConstraint = false;
    this.rConstraint = false;

    if (params.directionConstraint) {
      this.hConstraint = params.directionConstraint === 'horizontal' ? true : false;
      this.vConstraint = params.directionConstraint === 'vertical' ? true : false;
    }
    if (params.lengthConstraint) {
      this.rConstraint = true;
      this.rConstraintValue = params.lengthConstraint;
    }
    ['drawMove', 'drawEnd'].forEach(name => this[name] = this[name].bind(this));
    this.wasDragged = false;
    this.firstPoint = true;
    this.delIndices1 = [];
  }

  getGradeable() {
    let result = [],
        len = this.state.length,
        x1, y1, x2, y2;
    // Do not take into account dangling points from half drawn segments
    len =  len % 2 === 0 ? len : len - 1;
    for (let i = 0; i < len; i += 2) {
      x1 = this.state[i].x;
      y1 = this.state[i].y;
      x2 = this.state[i+1].x;
      y2 = this.state[i+1].y;
      // Use a spline to describe a line segment
      result.push({
        spline: [
          [x1, y1],
          [(2*x1 + x2)/3, (2*y1 + y2)/3],
          [(x1 + 2*x2)/3, (y1 + 2*y2)/3],
          [x2, y2]
        ],
        tag: this.state[i].tag
      })
    }
    return result;
  }

  addLineSegment(id, index) {
    if (this.id === id) {
      this.delIndices.push(index);
    }
  }

  addLineSegmentPoint(id, index) {
    if (this.id === id) {
      this.delIndices1.push(index);
    }
  }

  deleteLineSegments() {
    if (this.delIndices.length !== 0) {
      this.delIndices.sort();
      for (let i = this.delIndices.length -1; i >= 0; i--) {
        this.state.splice(this.delIndices[i], 2);
      }
      this.delIndices.length = 0;
      this.render();
    }
  }

  deleteLineSegmentPoints() {
    if (this.delIndices1.length !== 0) {
      this.delIndices1.sort();
      for (let i = this.delIndices1.length -1; i >= 0; i--) {
        this.state.splice(this.delIndices1[i], 1);
      }
      this.delIndices1.length = 0;
      this.render();
    }
  }

  // This will be called when clicking on the SVG canvas after having
  // selected the line segment shape
  initDraw(event) {
    let x = event.clientX - this.params.left,
        y = event.clientY - this.params.top,
        currentPosition = {
          x: x,
          y: y
        };
    // Add event listeners in capture phase
    document.addEventListener('pointermove', this.drawMove, true);
    document.addEventListener('pointerup', this.drawEnd, true);
    document.addEventListener('pointercancel', this.drawEnd, true);
    this.firstPoint = (this.state.length % 2 === 0);
    // Push current position
    // First endpoint, no constraint
    if (this.firstPoint) {
      // Only add tag to first point
      if (this.hasTag) {
        currentPosition.tag = this.tag.value;
      }
      this.state.push(currentPosition);
    }
    // Second endpoint, constrain with first endpoint
    else {
      let point = this.pointConstrained(x, y, this.state.length-1);
      currentPosition.x = point.x;
      currentPosition.y = point.y;
      this.state.push(currentPosition);
    }
    // If first endpoint, add immediately an undo point.
    // Otherwise, wait until drawEnd has been called to take in account eventual movemements
    // in drawMove.
    if (this.firstPoint) {
      this.app.addUndoPoint();
    }
    this.render();
    event.stopPropagation();
    event.preventDefault();
  }

  drawMove(event) {
    let x = event.clientX - this.params.left,
        y = event.clientY - this.params.top,
        point;

    x = this.clampX(x);
    y = this.clampY(y);
    // On a click & drag, only push a new point if the second endpoint has not been added.
    if (this.firstPoint) {
      // Constrain with first endpoint which is last in state, as second endpoint as not been yet added
      point = this.pointConstrained(x, y, this.state.length-1);
      this.state.push({
        x: point.x,
        y: point.y
      });
      this.firstPoint = false;
    }
    else {
      // Constrain with first endpoint which is before last in state, as second endpoint has been added
      let lastPosition = this.state[this.state.length-1];
      point = this.pointConstrained(x, y, this.state.length-2);
      lastPosition.x = point.x;
      lastPosition.y = point.y;
    }
    this.render();
    this.wasDragged = true;
    event.stopPropagation();
    event.preventDefault();
  }

  drawEnd(event) {
    document.removeEventListener('pointermove', this.drawMove, true);
    document.removeEventListener('pointerup', this.drawEnd, true);
    document.removeEventListener('pointercancel', this.drawEnd, true);
    // Only add an undo point for first endpoint if there was a drag.
    // Always add an undo point for second end point.
    if (!this.firstPoint || (this.firstPoint && this.wasDragged)) {
      this.app.addUndoPoint();
    }
    this.wasDragged = false;
    event.stopPropagation();
    event.preventDefault();
  }

  hConstrained(y, index) {
    let len = this.state.length;
    return this.hConstraint ? this.state[index].y : y;
  }

  vConstrained(x, index) {
    let len = this.state.length;
    return this.vConstraint ? this.state[index].x : x;
  }

  rConstrained(x2, y2, index) {
    let result = {
          x: x2,
          y: y2
        };
    if (this.rConstraint) {
      let x1 = this.state[index].x, y1 = this.state[index].y,
          vx = x2 - x1, vy = y2 - y1,
          dist = Math.sqrt(vx**2 + vy**2);
      if (dist > this.rConstraintValue) {
        let theta = Math.atan2(vy, vx);
        result.x = x1 + this.rConstraintValue*Math.cos(theta);
        result.y = y1 + this.rConstraintValue*Math.sin(theta);
      }
    }
    return result;
  }

  pointConstrained(x, y, index) {
    let point = this.rConstrained(x, y, index),
        xConstrained = this.vConstrained(point.x, index),
        yConstrained = this.hConstrained(point.y, index);

    return {
      x: xConstrained,
      y: yConstrained
    }
  }

  hConstrained1(y, index) {
    let len = this.state.length;
    return this.hConstraint && (len !== 0) && (len % 2 === 0) ? this.state[index].y : y;
  }

  vConstrained1(x, index) {
    let len = this.state.length;
    return this.vConstraint && (len !== 0) && (len % 2 === 0) ? this.state[index].x : x;
  }

  rConstrained1(x, y, index) {
    let len = this.state.length,
        result = {
          x: x,
          y: y
        };
    if (this.rConstraint && (len !== 0) && (len % 2 === 0)) {
      let xf, yf, xm, ym, vx, vy, dist;
      // First end point
      if (index % 2 === 0) {
        xm = x; ym = y;
        xf = this.state[index+1].x; yf = this.state[index+1].y;
      }
      // Second endpoint
      else {
        xf = this.state[index-1].x; yf = this.state[index-1].y;
        xm = x; ym = y;
      }
      vx = xm - xf, vy = ym - yf;
      dist = Math.sqrt(vx**2 + vy**2);
      if (dist > this.rConstraintValue) {
        let theta = Math.atan2(vy, vx);
        result.x = xf + this.rConstraintValue*Math.cos(theta);
        result.y = yf + this.rConstraintValue*Math.sin(theta);
      }
    }
    return result;
  }

  pointOpacity(ptIndex) {
    return (ptIndex === this.state.length - 1) && (ptIndex % 2 === 0) ? '' : 'opacity: 0';
  }

  pointClass(ptIndex) {
    return (ptIndex === this.state.length - 1) && (ptIndex % 2 === 0) ? '.line-segment-point' + '.plugin-id-' + this.id : '';
  }

  pointRadius(ptIndex) {
    return (ptIndex === this.state.length - 1) && (ptIndex % 2 === 0) ? 4 : 8;
  }

  arrowHead() {
    return this.params.arrowHead ? `url(#arrowhead-${this.params.id})` : ''
  }

  lineIsDefined(ptIndex) {
    return ptIndex % 2 === 0 && ptIndex < this.state.length - 1;
  }

  tagXPosition(ptIndex) {
    let x1 = this.state[ptIndex].x, x2;
    // The two points of the line segment have been defined
    if (this.lineIsDefined(ptIndex)) {
      x2 = this.state[ptIndex+1].x;
      switch(this.tag.position) {
        case 'start':
          return x1;
        case 'middle':
          return (x1+x2)/2;
        case 'end':
          return x2;
      }
    }
    else {
      return x1;
    }
  }

  tagYPosition(ptIndex) {
    let y1 = this.state[ptIndex].y, y2;
    // The two points of the line segment have been defined
    if (this.lineIsDefined(ptIndex)) {
      y2 = this.state[ptIndex+1].y;
      switch(this.tag.position) {
        case 'start':
          return y1;
        case 'middle':
          return (y1+y2)/2;
        case 'end':
          return y2;
      }
    }
    else {
      return y1;
    }
  }

  render() {
    z.render(this.el,
      // Draw visible line, under invisible line and endpoints
      z.each(this.state, (pt, ptIndex) =>
        z.if(this.lineIsDefined(ptIndex), () =>
          z('line.visible-' + ptIndex + '.line-segment' + '.plugin-id-' + this.id, {
            x1: this.state[ptIndex].x,
            y1: this.state[ptIndex].y,
            x2: this.state[ptIndex+1].x,
            y2: this.state[ptIndex+1].y,
            style: `
              stroke: ${this.params.color};
              stroke-width: 2px;
              stroke-dasharray: ${computeDashArray(this.params.dashStyle)};
              marker-end: ${this.arrowHead()};
            `
          })
        )
      ),
      // Draw invisible and selectable line, under invisible endpoints
      z.each(this.state, (pt, ptIndex) =>
        z.if(this.lineIsDefined(ptIndex), () =>
          z('line.invisible-' + ptIndex + this.readOnlyClass(), {
            x1: this.state[ptIndex].x,
            y1: this.state[ptIndex].y,
            x2: this.state[ptIndex+1].x,
            y2: this.state[ptIndex+1].y,
            style: `
              stroke: ${this.params.color};
              opacity: 0;
              stroke-width: 10px;
              stroke-dasharray: solid;
            `,
            onmount: el => {
              this.app.registerElement({
                ownerID: this.params.id,
                element: el,
                initialBehavior: 'none',
                onDrag: ({dx, dy}) => {
                  this.state[ptIndex].x += dx;
                  this.state[ptIndex].y += dy;
                  this.state[ptIndex+1].x += dx;
                  this.state[ptIndex+1].y += dy;
                  this.render();
                },
                inBoundsX: (dx) => {
                  return this.inBoundsX(this.state[ptIndex].x + dx) &&
                         this.inBoundsX(this.state[ptIndex+1].x + dx);
                },
                inBoundsY: (dy) => {
                  return this.inBoundsY(this.state[ptIndex].y + dy) &&
                         this.inBoundsY(this.state[ptIndex+1].y + dy)
                },
              });
            }
          })
        )
      ),
      // Draw invisible and selectable line endpoints
      z.each(this.state, (pt, ptIndex) =>
        z('circle.invisible-' + (ptIndex % 2 === 0 ? ptIndex : (ptIndex - 1).toString()) + this.pointClass(ptIndex) + this.readOnlyClass(), {
          cx: this.state[ptIndex].x,
          cy: this.state[ptIndex].y,
          r: this.pointRadius(ptIndex),
          style: `
            fill: ${this.params.color};
            stroke-width: 0;
          ` + this.pointOpacity(ptIndex),
          onmount: el => {
            this.app.registerElement({
              ownerID: this.params.id,
              element: el,
              initialBehavior: 'none',
              onDrag: ({dx, dy}) => {
                let x = this.state[ptIndex].x + dx,
                    y = this.state[ptIndex].y + dy,
                    point = this.rConstrained1(x, y, ptIndex),
                    xConstrained = this.vConstrained1(point.x, ptIndex),
                    yConstrained = this.hConstrained1(point.y, ptIndex);

                this.state[ptIndex].x = xConstrained;
                this.state[ptIndex].y = yConstrained;
                this.render();
              },
              inBoundsX: (dx) => {
                return this.inBoundsX(this.state[ptIndex].x + dx);
              },
              inBoundsY: (dy) => {
                return this.inBoundsY(this.state[ptIndex].y + dy)
              },
            });
          }
        })
      ),
      z.each(this.state, (pt, ptIndex) =>
        z.if(this.hasTag && ptIndex % 2 === 0, () =>
          z('text.tag', {
            'text-anchor': this.tag.align,
            x: this.tagXPosition(ptIndex) + this.tag.xoffset,
            y: this.tagYPosition(ptIndex) + this.tag.yoffset,
            style: `
              fill: #333;
              font-size: 14px;
              user-select: none;
              cursor: ${this.getTagCursor()};
            `,
            onmount: el => {
              if (!this.params.readonly) {
                el.addEventListener('dblclick', (event) => {
                  if (this.selectMode) {
                    let val = prompt('Enter tag value:');
                    if (val === null) {
                      return; // Happens when cancel button is pressed in prompt window
                    }
                    val.trim();
                    if (val !== '') {
                      this.state[ptIndex].tag = val;
                      this.app.addUndoPoint();
                      this.render();
                    }
                  }
                });
              }
            }
          }, this.state[ptIndex].tag)
        )
      )
    );
  }

  inBoundsX(x) {
    return x >= this.bounds.xmin && x <= this.bounds.xmax;
  }

  inBoundsY(y) {
    return y >= this.bounds.ymin && y <= this.bounds.ymax;
  }
}

const strokeWidth = 2;  // TODO: pass in
function computeDashArray(dashStyle) {
  var scale = Math.pow(strokeWidth, 0.6); // seems about right perceptually
  switch (dashStyle) {
    case 'dashed': return 5*scale + ',' + 3*scale;
    case 'longdashed': return 10*scale + ',' + 3*scale;
    case 'dotted': return 2*scale + ',' + 2*scale;
    case 'dashdotted': return 7*scale + ',' + 3*scale + ',' + 1.5*scale + ',' + 3*scale;
    case 'solid':  // falls through
    default: return '';
  }
}
