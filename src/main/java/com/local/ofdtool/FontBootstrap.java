package com.local.ofdtool;

import org.ofdrw.converter.FontLoader;
import org.ofdrw.font.EnvFont;

import java.awt.Font;
import java.awt.GraphicsEnvironment;
import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Improve CJK font resolution for OFD rendering on macOS.
 *
 * Many OFD files (e.g. certificates) only declare {@code FontName=华文楷体}
 * without embedding the font file. OFDRW's built-in scanner misses Apple's
 * downloadable CJK fonts and does not alias Chinese commercial names to
 * STKaiti / Kaiti SC, so text falls back to Trattatello.
 */
public final class FontBootstrap {
    private static volatile boolean done;

    private FontBootstrap() {}

    public static synchronized void init() {
        if (done) return;
        done = true;

        FontLoader loader = FontLoader.getInstance();
        loader.enableSimilarFontReplace();

        for (Path dir : macExtraFontDirs()) {
            if (Files.isDirectory(dir)) {
                try {
                    loader.scanFontDir(dir);
                } catch (Exception ignored) {
                    // best-effort scan
                }
            }
        }

        Path kaiti = findKaitiTtc();
        if (kaiti != null) {
            String path = kaiti.toAbsolutePath().toString();
            // Direct name → file mappings used by ImageMaker / PDF converter
            for (String name : new String[]{
                    "华文楷体", "STKaiti", "楷体", "KaiTi", "KaiTi_GB2312",
                    "Kaiti SC", "楷体-简", "楷體-簡", "Kaiti TC", "楷体-繁", "楷體-繁"
            }) {
                loader.addSystemFontMapping(name, path);
                loader.addAliasMapping(name, "STKaiti");
            }
            try {
                FontLoader.loadAsDefaultFont(path);
            } catch (Exception ignored) {}
        }

        // Name aliases even if TTC path was not found (helps when scan already indexed STKaiti)
        loader.addAliasMapping("华文楷体", "STKaiti");
        loader.addAliasMapping("华文宋体", "STSong");
        loader.addAliasMapping("华文黑体", "STHeiti");
        loader.addAliasMapping("华文仿宋", "STFangsong");
        loader.addAliasMapping("华文细黑", "STHeiti");
        loader.addAliasMapping("楷体", "STKaiti");
        loader.addAliasMapping("楷体_GB2312", "STKaiti");
        loader.addAliasMapping("KaiTi", "STKaiti");
        loader.addAliasMapping("Kaiti SC", "STKaiti");
        loader.addAliasMapping("楷体-简", "STKaiti");

        // AWT / EnvFont path (some OFDRW helpers still use it)
        mapEnvFont("华文楷体", "STKaiti", "Kaiti SC", "楷体-简");
        mapEnvFont("楷体", "STKaiti", "Kaiti SC");
        mapEnvFont("KaiTi", "STKaiti", "Kaiti SC");
        mapEnvFont("楷体_GB2312", "STKaiti");
        mapEnvFont("华文宋体", "STSong", "Songti SC");
        mapEnvFont("华文黑体", "STHeiti", "Heiti SC");
        mapEnvFont("宋体", "STSong", "Songti SC", "SimSong");
        mapEnvFont("黑体", "STHeiti", "Heiti SC");

        Font stKaiti = EnvFont.getFont("STKaiti");
        if (stKaiti == null) stKaiti = EnvFont.getFont("Kaiti SC");
        if (stKaiti != null) {
            EnvFont.setDefaultFont(stKaiti);
            EnvFont.setMapping("华文楷体", stKaiti);
        }
    }

    private static void mapEnvFont(String logical, String... candidates) {
        Font found = EnvFont.getFont(logical);
        if (found != null) return;
        for (String c : candidates) {
            Font f = EnvFont.getFont(c);
            if (f == null) {
                // Exact AWT family match (EnvFont normalizes; also try GraphicsEnvironment)
                for (String fam : GraphicsEnvironment.getLocalGraphicsEnvironment().getAvailableFontFamilyNames()) {
                    if (fam.equalsIgnoreCase(c) || fam.equals(c)) {
                        f = new Font(fam, Font.PLAIN, 12);
                        break;
                    }
                }
            }
            if (f != null) {
                EnvFont.setMapping(logical, f);
                return;
            }
        }
    }

    private static List<Path> macExtraFontDirs() {
        List<Path> dirs = new ArrayList<>();
        dirs.add(Path.of("/System/Library/Fonts/Supplemental"));
        dirs.add(Path.of("/Library/Fonts"));
        String user = System.getProperty("user.home");
        if (user != null) dirs.add(Path.of(user, "Library/Fonts"));

        Path assets = Path.of("/System/Library/AssetsV2/com_apple_MobileAsset_Font8");
        if (Files.isDirectory(assets)) {
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(assets)) {
                for (Path asset : stream) {
                    Path data = asset.resolve("AssetData");
                    if (Files.isDirectory(data)) dirs.add(data);
                }
            } catch (IOException ignored) {}
        }
        return dirs;
    }

    private static Path findKaitiTtc() {
        Path assets = Path.of("/System/Library/AssetsV2/com_apple_MobileAsset_Font8");
        if (Files.isDirectory(assets)) {
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(assets)) {
                for (Path asset : stream) {
                    Path kaiti = asset.resolve("AssetData").resolve("Kaiti.ttc");
                    if (Files.isRegularFile(kaiti)) return kaiti;
                }
            } catch (IOException ignored) {}
        }
        Path subset = Path.of("/System/Library/PrivateFrameworks/FontServices.framework/Versions/A/Resources/Fonts/Subsets/Kaiti.ttc");
        if (Files.isRegularFile(subset)) return subset;
        return null;
    }
}
