/**
 * Rendering a person in a list of people.
 *
 * Small enough to feel like it belongs in a component, kept here because the
 * edge cases are all in the string handling and testing them through a rendered
 * dropdown would be testing the wrong thing.
 */

/**
 * One or two letters standing in for a name, for the avatar in the author list.
 *
 * A surname, when there is one — "Manel Cárdenas" reads as MC, which separates
 * two Manels; a single-word name keeps one letter, because "MA" for "Manel" is
 * noise rather than information.
 *
 * Iterated by code point rather than by `charAt`, so a name starting outside the
 * BMP yields that character instead of half of a surrogate pair rendered as a
 * replacement glyph. Names are user-chosen text and this is the cheapest place
 * to be right about that.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  const first = [...words[0]][0] ?? "";
  if (words.length === 1) return first.toLocaleUpperCase();

  const last = [...words[words.length - 1]][0] ?? "";
  return (first + last).toLocaleUpperCase();
}
