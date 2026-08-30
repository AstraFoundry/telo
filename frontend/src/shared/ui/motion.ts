// The motion constants the primitives in this folder share. Siblings cannot
// import the vendored registry directly and cannot import the barrel either
// (it re-exports them, so the cycle would be self-referential), which is how
// hand-copied springs crept in: two primitives each carried their own literal
// of the button's press spring and would have silently kept the old feel if
// the registry were ever retuned.
export { EASE_OUT, SPRING_PRESS } from "@beui-lib/ease";
