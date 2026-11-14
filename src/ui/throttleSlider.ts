import Phaser from 'phaser';
import { t } from '../core/i18n';

export function throttleSlider(scene: Phaser.Scene, x: number, y: number, width: number,
  read: () => number, write: (value: number) => void, enabled: () => boolean = () => true): Phaser.GameObjects.Container {
  const root = scene.add.container(x, y).setDepth(55);
  const label = scene.add.text(0, 0, '', {fontFamily:'system-ui',fontSize:'14px',color:'#ffffff'});
  const rail = scene.add.rectangle(width / 2, 35, width, 8, 0x444a70);
  const fill = scene.add.rectangle(0, 35, width, 8, 0xffc640).setOrigin(0,0.5);
  const knob = scene.add.circle(width, 35, 10, 0xffe699).setStrokeStyle(2,0x15162b);
  const zone = scene.add.zone(width/2,35,width+20,34).setInteractive({useHandCursor:true});
  root.add([label,rail,fill,knob,zone]);
  let held = false;
  const move = (p: Phaser.Input.Pointer) => {
    if (!held || !enabled()) return;
    const local = root.getWorldTransformMatrix().applyInverse(p.x,p.y);
    write(Math.round(Phaser.Math.Clamp(local.x / width,0,1)*100)/100);
  };
  const up = () => { held = false; };
  zone.on('pointerdown', (p: Phaser.Input.Pointer) => {held = true; move(p);});
  scene.input.on('pointermove',move); scene.input.on('pointerup',up);
  const refresh = () => { const v = read(); fill.width=width*v; knob.x=width*v; label.setText(`${t('flight.hud.throttle')}: ${Math.round(v*100)}%`); };
  scene.events.on('update',refresh); refresh();
  const clean = () => {scene.input.off('pointermove',move);scene.input.off('pointerup',up);scene.events.off('update',refresh);};
  root.once('destroy',clean);
  return root;
}
