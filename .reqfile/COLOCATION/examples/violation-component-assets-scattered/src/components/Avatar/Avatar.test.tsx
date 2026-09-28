import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { ada } from "../../../fixtures/users";
import { Avatar } from "./Avatar";

test("uses the name as alt text", () => {
  const { getByAltText } = render(<Avatar name={ada.name} url={ada.url} />);
  expect(getByAltText("Ada Lovelace")).toBeTruthy();
});
