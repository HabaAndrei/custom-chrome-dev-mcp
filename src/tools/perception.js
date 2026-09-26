// Reading the page: accessibility outline, markup, text, attributes, geometry.
import { z } from "zod";
import { TARGET, definePassthrough } from "./schemas.js";

export function registerPerceptionTools(server) {
  const tool = definePassthrough(server);

  tool("snapshot", "Return the body's outerHTML (truncated to 50k chars). Use when you need exact markup; for choosing and targeting elements prefer snapshotA11y.", {});
  tool("snapshotA11y", "Return a compact accessibility outline of visible interactive elements as 'role \"name\" ref=eN' (links append href). The preferred way to perceive the page and obtain ref ids; refs expire on navigation or re-snapshot.", {});
  tool("getText", "Return the trimmed innerText of a single element (by selector, ref, or accessible name); use queryAll for many at once.", { ...TARGET });
  tool("getAttribute", "Return an element's attribute, falling back to the matching DOM property if absent (e.g. value, checked, href).", { ...TARGET, attr: z.string() });
  tool("queryAll", "Return text/href/value/visible for every element matching a CSS selector (capped by limit). Use to extract a list of elements at once.", { selector: z.string(), limit: z.number().optional() });
  tool("viewport", "Return the tab's devicePixelRatio, CSS viewport size, and scroll offset. Use to convert screenshot pixels (device px) to the CSS px realClick/x,y use: cssX = screenshotX / devicePixelRatio.", {});
  tool("getComputedStyle", "Return computed CSS for one element. Pass properties (camelCase CSS property names, e.g. ['display','color']) for just those; omit it for a curated default set covering box model, typography, and color.", { ...TARGET, properties: z.array(z.string()).optional() });
}
