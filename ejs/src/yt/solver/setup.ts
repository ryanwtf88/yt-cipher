import { parse } from "npm:meriyah@6.1.4";

export const setupNodes = parse(`
globalThis.XMLHttpRequest = { prototype: {} };
const window = Object.assign(Object.create(null), globalThis);
window.location = new URL("https://www.youtube.com/watch?v=yt-dlp-wins");
const document = {};
let self = globalThis;
`).body;
