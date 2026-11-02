/**
 * ingameMenuState.ts — pure state machine for the in-game pause/options menu.
 *
 * Kept separate from Phaser rendering so Escape-key transitions (open menu on
 * first Esc, resume game on second Esc, consume secondary overlays first, and
 * quit to main menu only on explicit Quit) can be unit-tested in Node.
 */

export type EscapeOutcome = 'opened' | 'closed' | 'consumed';

export interface InGameMenuCallbacks {
  /** Optional check before Esc opens the menu: if it returns true, Esc closed a
   *  secondary overlay (such as the Hub mission picker) instead of opening the menu. */
  onEscapeBeforeOpen?: () => boolean;
  /** Fired when the in-game menu opens. */
  onOpen?: () => void;
  /** Fired when the in-game menu closes and gameplay resumes. */
  onClose?: () => void;
  /** Fired when the player explicitly clicks Quit to return to the main menu. */
  onQuit: () => void;
}

export class InGameMenuController {
  private _isOpen = false;

  constructor(private readonly callbacks: InGameMenuCallbacks) {}

  get isOpen(): boolean {
    return this._isOpen;
  }

  /** Open the in-game menu if not already open. */
  open(): boolean {
    if (this._isOpen) return false;
    this._isOpen = true;
    this.callbacks.onOpen?.();
    return true;
  }

  /** Close the in-game menu and resume the game if currently open. */
  close(): boolean {
    if (!this._isOpen) return false;
    this._isOpen = false;
    this.callbacks.onClose?.();
    return true;
  }

  /** Toggle the in-game menu from a HUD button click. */
  toggle(): boolean {
    if (this._isOpen) {
      this.close();
      return false;
    }
    this.open();
    return true;
  }

  /** Handle pressing Escape while in-game:
   *  - If the in-game menu is open, Esc exits the in-game menu and resumes.
   *  - If a secondary overlay is open, Esc closes that overlay first.
   *  - Otherwise Esc opens the in-game menu without resetting the scene. */
  pressEscape(): EscapeOutcome {
    if (this._isOpen) {
      this.close();
      return 'closed';
    }
    if (this.callbacks.onEscapeBeforeOpen?.()) {
      return 'consumed';
    }
    this.open();
    return 'opened';
  }

  /** Explicitly quit to the main menu. */
  quit(): void {
    this._isOpen = false;
    this.callbacks.onQuit();
  }
}
