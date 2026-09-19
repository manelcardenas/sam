import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RecipeForm from "./RecipeForm";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import type { IngredientsData } from "@/lib/api-client";

/**
 * The form around the ingredient table.
 *
 * **One thing here blocks, and only one.** A recipe with no ingredients is not a
 * recipe — it is the one state the submit refuses. A *missing amount* never
 * blocks, and that asymmetry is the whole point: three mandatory fields are what
 * emptied these columns in the first place (2 of 111 lines had an amount), so
 * the fix nudges and explains rather than refusing.
 */

function setup(ingredients?: IngredientsData) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <LocaleProvider>
      <RecipeForm
        initialData={
          ingredients && {
            title: "Coca de llanda",
            instructions: null,
            ingredients,
            food_type: "postre",
          }
        }
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        submitLabel="Add recipe"
      />
    </LocaleProvider>,
  );
  return { onSubmit };
}

const submit = () => screen.getByRole("button", { name: /add recipe/i });

describe("the submit button", () => {
  it("is disabled while there is nothing to cook with", () => {
    setup();

    expect(submit()).toBeDisabled();
  });

  it("says why, rather than leaving you to guess", () => {
    // A disabled control that will not explain itself is half an error message.
    setup();

    const reason = screen.getByText(/add at least one ingredient/i);
    expect(reason).toBeInTheDocument();
    expect(submit()).toHaveAttribute("aria-describedby", reason.id);
  });

  it("comes alive once a row has a name", () => {
    setup({ servings: 4, items: [{ name: "Harina", amount: 210, unit: "g" }] });

    expect(submit()).toBeEnabled();
    expect(screen.queryByText(/add at least one ingredient/i)).not.toBeInTheDocument();
  });

  it("does not count a row whose name was cleared", () => {
    setup({ servings: 4, items: [{ name: "   " }] });

    expect(submit()).toBeDisabled();
  });

  it("is not blocked by a missing amount", () => {
    // The nudge is a nudge. This is the line that must never become a guard.
    setup({ servings: 4, items: [{ name: "Aceite de oliva" }] });

    expect(submit()).toBeEnabled();
  });
});

describe("submitting", () => {
  it("sends the rows with blank amounts left out rather than sent as empty", () => {
    const { onSubmit } = setup({ servings: 6, items: [{ name: "Harina", amount: 210, unit: "g" }, { name: "Sal" }] });

    fireEvent.click(submit());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        ingredients: { servings: 6, items: [{ name: "Harina", amount: 210, unit: "g" }, { name: "Sal", amount: undefined, unit: undefined }] },
      }),
    );
  });
});
