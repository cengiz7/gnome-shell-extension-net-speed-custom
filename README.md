# Net Speed Custom

Show current net speed on Ubuntu panel menu with highly customizable and lightweight shell extension.
Auto Light/Dark theme switch based on system preferred theme.

## Features:

1. **Customizable font size**: Available formats are `14px, 1.2em, 120% or "inherit"`. Default (inherit)
2. **Customizable download and upload speed label colors**: Provide a valid HEX color like: ff0000 (Red color)
3. **Customizable refresh interval**: You can provide decimal refresh interval values between 0.1 to 60 seconds. Default (1.0)
4. **Customizable Up and Down arrow symbols**: Click to cycle over and change it
5. **Settings save & load mechanism to preserve user settings.**

<br>
<img src="screenshot.jpg" alt="Screenshot" style="max-width: 700px; height: auto;" />

---

# Manual Installation

1. Copy the extension to extensions folder:  
   `$ git clone git@github.com:cengiz7/gnome-shell-extension-net-speed-custom.git ~/.local/share/gnome-shell/extensions/net-speed-custom@cengiz7.github.io`

2. Run schema compilation for persisten settings:  
   `cd ~/.local/share/gnome-shell/extensions/net-speed-custom@cengiz7.github.io && glib-compile-schemas schemas/`

3. Then you need to Log out and Log in to your Ubuntu session!. Alternatively you can press `Alt+F2 and then type "r"` without the commas. This will reload the extension list

4. Check if the extension successfully copied to proper folder:  
   `gnome-extensions list`

5. Enable the extension:  
   `gnome-extensions enable net-speed-custom@cengiz7.github.io`

To Disable the extension:  
`gnome-extensions disable net-speed-custom@cengiz7.github.io`

To Uninstall the extension:  
`gnome-extensions uninstall net-speed-custom@cengiz7.github.io`

### Note:

If GSettings schema isn't available or compatible in your OS then the extension will use default config variables. Settings save won't work.

## Building for Distribution

Exclude test files when packaging:

```bash
gnome-extensions pack --extra-source=stylesheet.css --extra-source=schemas/ --extra-source=README.md
```
