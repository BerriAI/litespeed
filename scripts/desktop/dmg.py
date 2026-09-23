"""Build Finder's drag-to-Applications window without scripting the user's desktop."""
import pathlib
import sys
import dmgbuild

app, background, output = map(pathlib.Path, sys.argv[1:4])
dmgbuild.build_dmg(str(output), "Litespeed", settings={
    "format": "UDZO",
    "filesystem": "HFS+",
    "files": [str(app)],
    "symlinks": {"Applications": "/Applications"},
    "background": str(background),
    "badge_icon": str(app / "Contents/Resources/Litespeed.icns"),
    "window_rect": ((180, 140), (720, 440)),
    "icon_locations": {"Litespeed.app": (218, 228), "Applications": (502, 228)},
    "icon_size": 112,
    "text_size": 13,
    "default_view": "icon-view",
    "show_toolbar": False,
    "show_status_bar": False,
    "show_tab_view": False,
    "show_pathbar": False,
    "show_sidebar": False,
    "include_icon_view_settings": True,
    "include_list_view_settings": False,
})
