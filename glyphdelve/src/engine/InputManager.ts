export interface KeyBindings {
  moveUp: string;
  moveDown: string;
  moveLeft: string;
  moveRight: string;
  skill1: string;
  skill2: string;
  skill3: string;
  interact: string;
  pause: string;
  [key: string]: string;
}

export const DEFAULT_BINDINGS: KeyBindings = {
  moveUp: 'KeyW',
  moveDown: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  skill1: 'Digit1',
  skill2: 'Digit2',
  skill3: 'Digit3',
  interact: 'KeyE',
  pause: 'Escape',
};

export class InputManager {
  private keysDown: Set<string> = new Set();
  private keysJustPressed: Set<string> = new Set();
  private mousePos = { x: 0, y: 0 };
  private mouseDown = false;
  private mouseJustClicked = false;
  private bindings: KeyBindings;
  private reverseBindings: Map<string, string> = new Map();
  private canvas: HTMLCanvasElement | null = null;

  constructor(bindings?: KeyBindings) {
    this.bindings = bindings || { ...DEFAULT_BINDINGS };
    this.buildReverseBindings();
  }

  private buildReverseBindings() {
    this.reverseBindings.clear();
    Object.entries(this.bindings).forEach(([action, code]) => {
      this.reverseBindings.set(code, action);
    });
  }

  setBindings(bindings: KeyBindings) {
    this.bindings = bindings;
    this.buildReverseBindings();
  }

  getBindings(): KeyBindings {
    return { ...this.bindings };
  }

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mouseup', this.onMouseUp);
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    if (this.canvas) {
      this.canvas.removeEventListener('mousemove', this.onMouseMove);
      this.canvas.removeEventListener('mousedown', this.onMouseDown);
      this.canvas.removeEventListener('mouseup', this.onMouseUp);
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.keysDown.has(e.code)) {
      this.keysJustPressed.add(e.code);
    }
    this.keysDown.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keysDown.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.canvas) {
      const rect = this.canvas.getBoundingClientRect();
      this.mousePos.x = e.clientX - rect.left;
      this.mousePos.y = e.clientY - rect.top;
    }
  };

  private onMouseDown = () => {
    this.mouseDown = true;
    this.mouseJustClicked = true;
  };

  private onMouseUp = () => {
    this.mouseDown = false;
  };

  isActionDown(action: string): boolean {
    const code = this.bindings[action];
    return code ? this.keysDown.has(code) : false;
  }

  isActionJustPressed(action: string): boolean {
    const code = this.bindings[action];
    return code ? this.keysJustPressed.has(code) : false;
  }

  isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  getMousePos() { return { ...this.mousePos }; }
  isMouseDown() { return this.mouseDown; }
  isMouseJustClicked() { return this.mouseJustClicked; }

  endFrame() {
    this.keysJustPressed.clear();
    this.mouseJustClicked = false;
  }
}
