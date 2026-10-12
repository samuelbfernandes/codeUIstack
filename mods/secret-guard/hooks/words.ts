/** True for the person's own typing (the composer or the phone bridge), never a notification, a schedule or a plugin. */
export const isPeople = (origin: { kind: string }): boolean => origin.kind === 'composer' || origin.kind === 'bridge'
