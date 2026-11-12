// Capteur de glisser-déposer pour la souris et le stylet seulement. Au doigt,
// c'est TouchSensor (appui maintenu) qui prend le relais : sinon le moindre
// défilement de la grille ferait partir une miniature.
import type { PointerEvent } from 'react';
import { PointerSensor, type PointerSensorOptions } from '@dnd-kit/core';

export class MouseOrPenSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: PointerEvent, { onActivation }: PointerSensorOptions): boolean => {
        if (!event.isPrimary || event.button !== 0 || event.pointerType === 'touch') return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}
