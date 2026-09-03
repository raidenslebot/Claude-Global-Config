// The host side of the swell: the ping-pong buffers the fragment reads from, an
// instanced draw for the spray, and a compute pass that advances the particle state
// on the GPU. Fixture: the half of a GPU piece that is not the fragment.

export function createPipeline(gl, count = 200000) {
  // Two targets, swapped each frame. This frame reads the last one; that is what
  // makes trails, decay and reaction-diffusion possible at all.
  const targets = [makeTarget(gl), makeTarget(gl)]
  let read = 0

  function makeTarget(gl) {
    const framebuffer = gl.createFramebuffer()
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, gl.drawingBufferWidth, gl.drawingBufferHeight, 0, gl.RGBA, gl.FLOAT, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return { framebuffer, tex }
  }

  const pingPong = () => { read = 1 - read; return { src: targets[read].tex, dst: targets[1 - read].framebuffer } }

  // Spray: one draw call, a quarter of a million sprites, each with its own transform
  // read from an instanced attribute.
  function drawSpray(program, vao) {
    gl.useProgram(program)
    gl.bindVertexArray(vao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
  }

  return { pingPong, drawSpray, targets }
}

// The state itself lives on the device, so a million particles costs nothing to move.
export const advanceParticles = /* wgsl */ `
struct Particle { pos: vec2<f32>, vel: vec2<f32> };
@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  var p = particles[i];
  p.vel = p.vel * 0.985 + vec2<f32>(0.0, -0.0004);
  p.pos = p.pos + p.vel;
  particles[i] = p;
}
`
