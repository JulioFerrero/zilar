export function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

export function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) {
    return undefined;
  }
  return args[index + 1];
}
