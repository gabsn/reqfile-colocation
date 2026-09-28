import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { Avatar } from "./Avatar";
import { ada } from "./fixtures";

test("uses the name as alt text", () => {
  const { getByAltText } = render(<Avatar name={ada.name} url={ada.url} />);
  expect(getByAltText("Ada Lovelace")).toBeTruthy();
});
