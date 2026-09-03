// Twelve months of tide heights, drawn as small multiples with the uncertainty
// shown. Fixture for the data-visualisation vocabulary.

import * as d3 from 'd3'

export function draw(root, months, { width = 960 } = {}) {
  // Perceptual interpolation: a scale that reads as ordered, with no false bright band.
  const depth = d3.scaleSequential(d3.interpolateHcl('#efe9dc', '#1f2a44')).domain([0, 6])

  // The range of a tide is not linear in its forcing, so the scale is not either.
  const y = d3.scaleSqrt().domain([0, 6]).range([120, 0])
  const x = d3.scaleLinear().domain([0, 24]).range([0, 200])

  // One shape repeated across a dimension, rather than twelve series on one axis.
  const facet = d3.select(root).selectAll('svg.facet')
    .data(months, (m) => m.name)
    .join('svg')
    .attr('class', 'facet small-multiple')
    .attr('width', 220)
    .attr('height', 150)

  const area = d3.area().x((d) => x(d.hour)).y0((d) => y(d.low)).y1((d) => y(d.high))
  const line = d3.line().x((d) => x(d.hour)).y((d) => y(d.mean)).curve(d3.curveNatural)

  // The confidence band. An estimate drawn as a single line is a claim the data
  // cannot support, so the interval is the mark and the mean rides inside it.
  facet.append('path')
    .attr('class', 'interval')
    .attr('d', (m) => area(m.hours))
    .attr('fill', (m) => depth(m.meanRange))
    .attr('opacity', (m) => 0.25 + m.stddev / 4)

  facet.append('path').attr('class', 'mean').attr('d', (m) => line(m.hours))

  // Direct labelling on the mark: a legend is a lookup table the reader has to
  // hold in their head while they read the chart.
  facet.append('text').attr('x', 4).attr('y', 14).text((m) => m.name)

  facet.append('line')
    .attr('class', 'reference line')
    .attr('x1', 0).attr('x2', 200)
    .attr('y1', y(4.2)).attr('y2', y(4.2))

  facet.append('text')
    .attr('class', 'annotation callout')
    .attr('x', 200).attr('y', y(4.2) - 4)
    .attr('text-anchor', 'end')
    .text('steps awash')

  // Object constancy: the reader can follow a value moving between states.
  facet.selectAll('path.mean')
    .data((m) => [m])
    .join('path')
    .transition().duration(600)
    .attr('d', (m) => line(m.hours))

  facet.selectAll('circle.turn')
    .data((m) => m.turns)
    .enter().append('circle')
    .attr('r', 2.5)
    .exit().remove()

  // Detail on demand: a Voronoi hit layer, a tooltip, and a brush over the year.
  const points = months.flatMap((m) => m.hours.map((h) => [x(h.hour), y(h.mean)]))
  const hit = d3.Delaunay.from(points)
  facet.on('pointermove', (event) => {
    const i = hit.find(...d3.pointer(event))
    root.querySelector('.tooltip').textContent = i >= 0 ? points[i][1].toFixed(2) + ' m' : ''
  })
  d3.select(root).append('g').call(d3.brushX().extent([[0, 0], [width, 30]]))
  d3.select(root).call(d3.zoom().scaleExtent([1, 8]))

  // Overplotting handled rather than ignored: density carried by opacity, and the
  // heaviest months drawn last so they are not buried.
  facet.sort((a, b) => a.stddev - b.stddev)
    .attr('opacity', (m) => 0.35 + m.stddev / 3)

  // Layout computed from the data rather than poured into a fixed frame.
  const packed = d3.pack().size([width, 200])(
    d3.hierarchy({ children: months }).sum((m) => m.meanRange || 1))

  return { facet, packed }
}
