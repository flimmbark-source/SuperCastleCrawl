export type UpdateFn = (dt: number) => void;
export type RenderFn = (interp: number) => void;

export class GameLoop {
  private updateFn: UpdateFn;
  private renderFn: RenderFn;
  private tickRate = 1000 / 60; // 60 Hz logic
  private lastTime = 0;
  private accumulator = 0;
  private running = false;
  private rafId = 0;
  private _gameSpeed = 1.0;
  private _paused = false;

  constructor(update: UpdateFn, render: RenderFn) {
    this.updateFn = update;
    this.renderFn = render;
  }

  set gameSpeed(v: number) { this._gameSpeed = v; }
  get gameSpeed() { return this._gameSpeed; }
  set paused(v: boolean) { this._paused = v; }
  get paused() { return this._paused; }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.loop(this.lastTime);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private loop = (now: number) => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    let frameTime = now - this.lastTime;
    this.lastTime = now;

    // Clamp large frame gaps
    if (frameTime > 100) frameTime = 100;

    if (!this._paused) {
      this.accumulator += frameTime * this._gameSpeed;

      while (this.accumulator >= this.tickRate) {
        this.updateFn(this.tickRate / 1000);
        this.accumulator -= this.tickRate;
      }
    }

    this.renderFn(this.accumulator / this.tickRate);
  };
}
