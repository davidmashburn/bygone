# macOS Cmd-W window close

## Summary

Make `Cmd-W` close the active Bygone window on macOS.

## Why it might matter

The standalone Window menu currently omits Electron's `close` role on macOS,
so the platform-standard close-window shortcut is unavailable. Closing must
still use the existing dirty-session confirmation and must target only the
active window.

## Open questions

- Should the menu show an explicit **Close Window** item on every platform or
  rely on the platform role where it already works?
- Do main Explore windows and independently opened tour windows share the same
  close and last-window lifecycle?

## Possible next steps

Add a focused standalone menu/lifecycle test before assigning `CmdOrCtrl+W` or
the platform `close` role, including cancellation when the active window has
unsaved edits.
