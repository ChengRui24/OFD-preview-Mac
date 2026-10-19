package com.local.ofdtool;

import org.ofdrw.converter.ConvertHelper;
import org.ofdrw.converter.ImageMaker;
import org.ofdrw.converter.SVGMaker;
import org.ofdrw.reader.ContentExtractor;
import org.ofdrw.reader.OFDReader;
import org.ofdrw.reader.PageInfo;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Shared OFD read / convert helpers used by CLI and GUI. */
public final class OfdService {
    private OfdService() {}

    public static String stem(Path file) {
        String name = file.getFileName().toString();
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }

    public static Path sourceDir(Path file) {
        Path parent = file.toAbsolutePath().normalize().getParent();
        return parent != null ? parent : Path.of(".");
    }

    public static DocumentInfo readInfo(Path in) throws IOException {
        try (OFDReader reader = new OFDReader(in)) {
            List<PageSize> pages = new ArrayList<>();
            for (PageInfo p : reader.getPageList()) {
                if (p.getSize() != null) {
                    pages.add(new PageSize(p.getIndex(), p.getSize().getWidth(), p.getSize().getHeight()));
                }
            }
            int attachments = 0;
            try { attachments = reader.getAttachmentList().size(); } catch (Exception ignored) {}
            return new DocumentInfo(reader.getNumberOfPages(), reader.hasSignature(), attachments, pages);
        }
    }

    public static String extractText(Path in) throws IOException {
        try (OFDReader reader = new OFDReader(in)) {
            ContentExtractor extractor = new ContentExtractor(reader);
            StringBuilder sb = new StringBuilder();
            for (int i = 1; i <= reader.getNumberOfPages(); i++) {
                sb.append("===== 第 ").append(i).append(" 页 =====\n");
                for (String line : extractor.getPageContent(i)) sb.append(line).append('\n');
            }
            return sb.toString();
        }
    }

    public static Path toPdf(Path in) throws Exception {
        return toPdf(in, sourceDir(in).resolve(stem(in) + ".pdf"));
    }

    public static Path toPdf(Path in, Path out) throws Exception {
        Path target = out.toAbsolutePath().normalize();
        if (target.getParent() != null) Files.createDirectories(target.getParent());
        ConvertHelper.toPdf(in, target);
        return target;
    }

    public static List<Path> toImages(Path in, String fmt, int ppm) throws Exception {
        return toImages(in, sourceDir(in).resolve(stem(in) + "." + fmt), fmt, ppm);
    }

    /**
     * Export pages as images.
     * {@code chosenFile} is the path picked in the save dialog (e.g. {@code foo.png}).
     * Single page → exact path; multiple pages → {@code foo-001.png}, {@code foo-002.png}, …
     */
    public static List<Path> toImages(Path in, Path chosenFile, String fmt, int ppm) throws Exception {
        Path chosen = chosenFile.toAbsolutePath().normalize();
        Path dir = chosen.getParent() != null ? chosen.getParent() : Path.of(".");
        Files.createDirectories(dir);
        String base = stem(chosen);
        String ext = fmt.equals("jpeg") ? "jpg" : fmt;
        List<Path> outs = new ArrayList<>();
        try (OFDReader reader = new OFDReader(in)) {
            ImageMaker maker = new ImageMaker(reader, ppm);
            int pages = maker.pageSize();
            for (int i = 0; i < pages; i++) {
                BufferedImage img = maker.makePage(i);
                Path out = pages == 1
                        ? ensureExtension(chosen, ext)
                        : dir.resolve(String.format("%s-%03d.%s", base, i + 1, ext));
                ImageIO.write(img, ext.equals("jpg") ? "jpeg" : ext, out.toFile());
                outs.add(out);
            }
        }
        return outs;
    }

    public static List<Path> toSvg(Path in) throws Exception {
        return toSvg(in, sourceDir(in).resolve(stem(in) + ".svg"));
    }

    /** Same naming rules as {@link #toImages(Path, Path, String, int)}. */
    public static List<Path> toSvg(Path in, Path chosenFile) throws Exception {
        Path chosen = chosenFile.toAbsolutePath().normalize();
        Path dir = chosen.getParent() != null ? chosen.getParent() : Path.of(".");
        Files.createDirectories(dir);
        String base = stem(chosen);
        List<Path> outs = new ArrayList<>();
        try (OFDReader reader = new OFDReader(in)) {
            SVGMaker maker = new SVGMaker(reader, 15);
            int pages = maker.pageSize();
            for (int i = 0; i < pages; i++) {
                Path out = pages == 1
                        ? ensureExtension(chosen, "svg")
                        : dir.resolve(String.format("%s-%03d.svg", base, i + 1));
                Files.write(out, maker.makePage(i).getBytes(StandardCharsets.UTF_8));
                outs.add(out);
            }
        }
        return outs;
    }

    private static Path ensureExtension(Path file, String ext) {
        String name = file.getFileName().toString();
        String lower = name.toLowerCase();
        if (lower.endsWith("." + ext) || (ext.equals("jpg") && lower.endsWith(".jpeg"))) return file;
        Path parent = file.getParent();
        Path named = Path.of(name + "." + ext);
        return parent != null ? parent.resolve(named) : named;
    }

    /** Preview pages as images. pageIndex is 0-based. */
    public static BufferedImage renderPage(Path in, int pageIndex0, int ppm) throws IOException {
        try (OFDReader reader = new OFDReader(in)) {
            ImageMaker maker = new ImageMaker(reader, ppm);
            if (pageIndex0 < 0 || pageIndex0 >= maker.pageSize()) {
                throw new IOException("页码无效: " + (pageIndex0 + 1));
            }
            return maker.makePage(pageIndex0);
        }
    }

    public static int pageCount(Path in) throws IOException {
        try (OFDReader reader = new OFDReader(in)) {
            return reader.getNumberOfPages();
        }
    }

    public record PageSize(int index, double widthMm, double heightMm) {}

    public record DocumentInfo(int pages, boolean signed, int attachments, List<PageSize> pageSizes) {
        public String summary(Path file) {
            StringBuilder sb = new StringBuilder();
            sb.append("文件: ").append(file.toAbsolutePath()).append('\n');
            sb.append("页数: ").append(pages).append('\n');
            sb.append("有签名: ").append(signed).append('\n');
            sb.append("附件数: ").append(attachments).append('\n');
            for (PageSize p : pageSizes) {
                sb.append(String.format("  第%d页: %.2f x %.2f mm%n", p.index(), p.widthMm(), p.heightMm()));
            }
            return sb.toString();
        }
    }
}
