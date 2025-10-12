export const noTransform = <T>(value: T) => value

export const inputEventTransform = <E>(event: E) => (event as { target: HTMLInputElement })?.target?.value as any

export const checkEventTransform = <E>(event: E) => (event as { target: HTMLInputElement })?.target?.checked as any
