export class NamingConvention {
  private readonly PREFIX = "RecipeManager";

  withPrefix(name: string): string {
    return `${this.PREFIX}${name}`;
  }
}
