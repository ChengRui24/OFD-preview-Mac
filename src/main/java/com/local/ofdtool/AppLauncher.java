package com.local.ofdtool;

/**
 * Single entry for fat-jar / Mac .app:
 * - CLI subcommands (info/text/to-pdf/...) → {@link Main}
 * - otherwise → {@link OfdApp} GUI (double-click .ofd, drag-drop, preview)
 */
public final class AppLauncher {
    public static void main(String[] args) throws Exception {
        FontBootstrap.init();
        if (args.length >= 1 && Main.COMMANDS.contains(args[0])) {
            Main.main(args);
            return;
        }
        OfdApp.main(args);
    }
}
