package com.local.ofdtool;

import org.ofdrw.converter.ConvertHelper;
import org.ofdrw.converter.ImageMaker;
import org.ofdrw.converter.SVGMaker;
import org.ofdrw.reader.OFDReader;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;
import java.util.Set;

/** CLI entry: ofd info|text|to-pdf|to-image|to-svg */
public class Main {
    private static final Set<String> IMAGE_FORMATS = Set.of("png", "jpg", "jpeg");
    static final Set<String> COMMANDS = Set.of("info", "text", "to-pdf", "to-image", "to-svg");

    public static void main(String[] args) throws Exception {
        if (args.length < 2) { usage(); return; }
        String cmd = args[0];
        Path in = Paths.get(args[1]).toAbsolutePath().normalize();
        if (!Files.exists(in)) { System.err.println("文件不存在: " + in); System.exit(1); }
        String stem = OfdService.stem(in);
        Path srcDir = OfdService.sourceDir(in);

        switch (cmd) {
            case "info":
                System.out.print(OfdService.readInfo(in).summary(in));
                break;
            case "text": {
                String text = OfdService.extractText(in);
                if (args.length >= 3) {
                    Path out = Paths.get(args[2]);
                    if (out.getParent() != null) Files.createDirectories(out.getParent());
                    Files.writeString(out, text, StandardCharsets.UTF_8);
                    System.out.println("已提取文本: " + out.toAbsolutePath());
                } else {
                    System.out.print(text);
                }
                break;
            }
            case "to-pdf": {
                Path pdf = args.length >= 3
                        ? Paths.get(args[2]).toAbsolutePath().normalize()
                        : srcDir.resolve(stem + ".pdf");
                if (pdf.getParent() != null) Files.createDirectories(pdf.getParent());
                ConvertHelper.toPdf(in, pdf);
                System.out.println("已生成 PDF: " + pdf);
                break;
            }
            case "to-image": {
                ImageOptions opt = parseImageOptions(args, srcDir);
                Files.createDirectories(opt.dir);
                try (OFDReader reader = new OFDReader(in)) {
                    ImageMaker maker = new ImageMaker(reader, opt.ppm);
                    for (int i = 0; i < maker.pageSize(); i++) {
                        BufferedImage img = maker.makePage(i);
                        String name = opt.useStem
                                ? String.format("%s-%03d.%s", stem, i + 1, opt.fmt)
                                : String.format("page-%03d.%s", i + 1, opt.fmt);
                        File out = opt.dir.resolve(name).toFile();
                        ImageIO.write(img, opt.fmt.equals("jpg") ? "jpeg" : opt.fmt, out);
                        System.out.println("已生成: " + out.getAbsolutePath()
                                + " (" + img.getWidth() + "x" + img.getHeight() + ")");
                    }
                }
                break;
            }
            case "to-svg": {
                boolean defaultDir = args.length < 3;
                Path dir = defaultDir ? srcDir : Paths.get(args[2]).toAbsolutePath().normalize();
                Files.createDirectories(dir);
                try (OFDReader reader = new OFDReader(in)) {
                    SVGMaker maker = new SVGMaker(reader, 15);
                    for (int i = 0; i < maker.pageSize(); i++) {
                        String name = defaultDir
                                ? String.format("%s-%03d.svg", stem, i + 1)
                                : String.format("page-%03d.svg", i + 1);
                        Path out = dir.resolve(name);
                        Files.write(out, maker.makePage(i).getBytes(StandardCharsets.UTF_8));
                        System.out.println("已生成: " + out.toAbsolutePath());
                    }
                }
                break;
            }
            default:
                usage();
                System.exit(1);
        }
    }

    private static ImageOptions parseImageOptions(String[] args, Path srcDir) {
        Path dir = srcDir;
        String fmt = "png";
        int ppm = 15;
        boolean useStem = true;
        if (args.length >= 3) {
            String a2 = args[2].toLowerCase(Locale.ROOT);
            if (IMAGE_FORMATS.contains(a2)) {
                fmt = a2.equals("jpeg") ? "jpg" : a2;
                if (args.length >= 4) ppm = Integer.parseInt(args[3]);
            } else {
                dir = Paths.get(args[2]).toAbsolutePath().normalize();
                useStem = false;
                if (args.length >= 4) {
                    fmt = args[3].toLowerCase(Locale.ROOT);
                    if (fmt.equals("jpeg")) fmt = "jpg";
                }
                if (args.length >= 5) ppm = Integer.parseInt(args[4]);
            }
        }
        return new ImageOptions(dir, fmt, ppm, useStem);
    }

    static void usage() {
        System.out.println("OFDRW 工具 (ofdrw 2.3.7) 用法:");
        System.out.println("  ofd info     <文件.ofd>");
        System.out.println("  ofd text     <文件.ofd> [输出.txt]              不指定输出则打印到终端");
        System.out.println("  ofd to-pdf   <文件.ofd> [输出.pdf]              默认：源目录/同名.pdf");
        System.out.println("  ofd to-image <文件.ofd> [输出目录] [png|jpg] [PPM]");
        System.out.println("                                             默认：源目录/同名-001.png");
        System.out.println("  ofd to-svg   <文件.ofd> [输出目录]              默认：源目录/同名-001.svg");
    }

    private static final class ImageOptions {
        final Path dir;
        final String fmt;
        final int ppm;
        final boolean useStem;

        ImageOptions(Path dir, String fmt, int ppm, boolean useStem) {
            this.dir = dir;
            this.fmt = fmt;
            this.ppm = ppm;
            this.useStem = useStem;
        }
    }
}
