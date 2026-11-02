import { describe, it, expect, vi } from 'vitest';
import { InGameMenuController } from '../src/core/ingameMenuState';

describe('InGameMenuController', () => {
  it('opens the in-game menu on first Esc instead of quitting to the main menu', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const onQuit = vi.fn();
    const menu = new InGameMenuController({ onOpen, onClose, onQuit });

    expect(menu.isOpen).toBe(false);
    expect(menu.pressEscape()).toBe('opened');
    expect(menu.isOpen).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(onQuit).not.toHaveBeenCalled();
  });

  it('exits the in-game menu on second Esc without resetting the game', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const onQuit = vi.fn();
    const menu = new InGameMenuController({ onOpen, onClose, onQuit });

    menu.pressEscape(); // open
    expect(menu.isOpen).toBe(true);

    expect(menu.pressEscape()).toBe('closed'); // exit in-game menu
    expect(menu.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onQuit).not.toHaveBeenCalled();
  });

  it('sends the user to the main menu when Quit is triggered', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const onQuit = vi.fn();
    const menu = new InGameMenuController({ onOpen, onClose, onQuit });

    menu.pressEscape();
    expect(menu.isOpen).toBe(true);

    menu.quit();
    expect(menu.isOpen).toBe(false);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('closes a secondary overlay first on Esc before opening the in-game menu', () => {
    let boardOpen = true;
    const onOpen = vi.fn();
    const onQuit = vi.fn();
    const menu = new InGameMenuController({
      onEscapeBeforeOpen: () => {
        if (boardOpen) {
          boardOpen = false;
          return true;
        }
        return false;
      },
      onOpen,
      onQuit,
    });

    // First Esc closes the mission board
    expect(menu.pressEscape()).toBe('consumed');
    expect(boardOpen).toBe(false);
    expect(menu.isOpen).toBe(false);
    expect(onQuit).not.toHaveBeenCalled();

    // Next Esc opens the in-game menu
    expect(menu.pressEscape()).toBe('opened');
    expect(menu.isOpen).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);

    // Next Esc exits the in-game menu
    expect(menu.pressEscape()).toBe('closed');
    expect(menu.isOpen).toBe(false);
  });

  it('toggles open and closed from HUD button', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const onQuit = vi.fn();
    const menu = new InGameMenuController({ onOpen, onClose, onQuit });

    expect(menu.toggle()).toBe(true);
    expect(menu.isOpen).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);

    expect(menu.toggle()).toBe(false);
    expect(menu.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onQuit).not.toHaveBeenCalled();
  });
});
