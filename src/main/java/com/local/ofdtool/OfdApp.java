package com.local.ofdtool;

import javax.swing.BorderFactory;
import javax.swing.ImageIcon;
import javax.swing.JButton;
import javax.swing.JFileChooser;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JMenu;
import javax.swing.JMenuBar;
import javax.swing.JMenuItem;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.JToolBar;
import javax.swing.SwingUtilities;
import javax.swing.SwingWorker;
import javax.swing.UIManager;
import javax.swing.filechooser.FileNameExtensionFilter;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Desktop;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.awt.Image;
import java.awt.datatransfer.DataFlavor;
import java.awt.dnd.DnDConstants;
import java.awt.dnd.DropTarget;
import java.awt.dnd.DropTargetAdapter;
import java.awt.dnd.DropTargetDropEvent;
import java.awt.event.KeyEvent;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * Mac-friendly OFD viewer: double-click / Open With / drag-drop → preview,
 * convert to PDF/PNG/SVG into the source directory.
 */
public final class OfdApp extends JFrame {
    private static final int PREVIEW_PPM = 10;

    private final JLabel previewLabel = new JLabel("打开或拖入 .ofd 文件以预览", JLabel.CENTER);
    private final JLabel statusLabel = new JLabel("就绪");
    private final JLabel pageLabel = new JLabel("—");
    private final JButton prevBtn = new JButton("上一页");
    private final JButton nextBtn = new JButton("下一页");
    private final JButton pdfBtn = new JButton("转 PDF");
    private final JButton pngBtn = new JButton("转 PNG");
    private final JButton svgBtn = new JButton("转 SVG");
    private final JButton textBtn = new JButton("提取文字");
    private final JButton infoBtn = new JButton("文档信息");

    private Path currentFile;
    private int pageCount;
    private int pageIndex; // 0-based
    private BufferedImage currentImage;

    public OfdApp() {
        super("OFD 预览");
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        setMinimumSize(new Dimension(900, 700));
        setLocationRelativeTo(null);
        buildUi();
        enableDrop();
        setConvertEnabled(false);
    }

    public static void main(String[] args) {
        System.setProperty("apple.awt.application.name", "OFD预览");
        System.setProperty("apple.laf.useScreenMenuBar", "true");
        try {
            UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
        } catch (Exception ignored) {}

        SwingUtilities.invokeLater(() -> {
            OfdApp app = new OfdApp();
            registerOpenHandler(app);
            app.setVisible(true);
            if (args != null) {
                for (String a : args) {
                    if (a == null || a.isBlank()) continue;
                    Path p = Path.of(a);
                    if (Files.isRegularFile(p) && a.toLowerCase().endsWith(".ofd")) {
                        app.openFile(p);
                        break;
                    }
                }
            }
        });
    }

    private static void registerOpenHandler(OfdApp app) {
        if (!Desktop.isDesktopSupported()) return;
        Desktop desktop = Desktop.getDesktop();
        if (desktop.isSupported(Desktop.Action.APP_OPEN_FILE)) {
            desktop.setOpenFileHandler(event -> {
                List<File> files = event.getFiles();
                if (files == null || files.isEmpty()) return;
                File f = files.get(0);
                SwingUtilities.invokeLater(() -> app.openFile(f.toPath()));
            });
        }
    }

    private void buildUi() {
        JMenuBar bar = new JMenuBar();
        JMenu fileMenu = new JMenu("文件");
        JMenuItem openItem = new JMenuItem("打开…", KeyEvent.VK_O);
        openItem.addActionListener(e -> chooseAndOpen());
        fileMenu.add(openItem);
        bar.add(fileMenu);
        setJMenuBar(bar);

        JToolBar tools = new JToolBar();
        tools.setFloatable(false);
        JButton openBtn = new JButton("打开");
        openBtn.addActionListener(e -> chooseAndOpen());
        prevBtn.addActionListener(e -> showPage(pageIndex - 1));
        nextBtn.addActionListener(e -> showPage(pageIndex + 1));
        pdfBtn.addActionListener(e -> convertWithSaveDialog("PDF"));
        pngBtn.addActionListener(e -> convertWithSaveDialog("PNG"));
        svgBtn.addActionListener(e -> convertWithSaveDialog("SVG"));
        textBtn.addActionListener(e -> showText());
        infoBtn.addActionListener(e -> showInfo());

        tools.add(openBtn);
        tools.addSeparator();
        tools.add(prevBtn);
        tools.add(pageLabel);
        tools.add(nextBtn);
        tools.addSeparator();
        tools.add(pdfBtn);
        tools.add(pngBtn);
        tools.add(svgBtn);
        tools.addSeparator();
        tools.add(textBtn);
        tools.add(infoBtn);

        previewLabel.setOpaque(true);
        previewLabel.setBackground(new Color(0xF2, 0xF2, 0xF2));
        previewLabel.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 16));
        JScrollPane scroll = new JScrollPane(previewLabel);
        scroll.getVerticalScrollBar().setUnitIncrement(24);

        JPanel status = new JPanel(new FlowLayout(FlowLayout.LEFT));
        status.setBorder(BorderFactory.createEmptyBorder(2, 8, 2, 8));
        status.add(statusLabel);

        add(tools, BorderLayout.NORTH);
        add(scroll, BorderLayout.CENTER);
        add(status, BorderLayout.SOUTH);
    }

    private void enableDrop() {
        new DropTarget(previewLabel, new DropTargetAdapter() {
            @Override
            @SuppressWarnings("unchecked")
            public void drop(DropTargetDropEvent event) {
                try {
                    event.acceptDrop(DnDConstants.ACTION_COPY);
                    Object data = event.getTransferable().getTransferData(DataFlavor.javaFileListFlavor);
                    List<File> files = (List<File>) data;
                    for (File f : files) {
                        if (f.getName().toLowerCase().endsWith(".ofd")) {
                            openFile(f.toPath());
                            event.dropComplete(true);
                            return;
                        }
                    }
                    event.dropComplete(false);
                    status("请拖入 .ofd 文件");
                } catch (Exception ex) {
                    event.dropComplete(false);
                    error("拖入失败", ex);
                }
            }
        });
    }

    private void chooseAndOpen() {
        JFileChooser chooser = new JFileChooser();
        chooser.setFileFilter(new FileNameExtensionFilter("OFD 文件 (*.ofd)", "ofd"));
        if (currentFile != null) chooser.setCurrentDirectory(currentFile.getParent().toFile());
        if (chooser.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) {
            openFile(chooser.getSelectedFile().toPath());
        }
    }

    void openFile(Path path) {
        Path abs = path.toAbsolutePath().normalize();
        if (!Files.isRegularFile(abs)) {
            status("文件不存在: " + abs);
            return;
        }
        setConvertEnabled(false);
        status("正在加载预览…");
        previewLabel.setIcon(null);
        previewLabel.setText("正在渲染…");
        new SwingWorker<PreviewData, Void>() {
            @Override
            protected PreviewData doInBackground() throws Exception {
                int pages = OfdService.pageCount(abs);
                BufferedImage img = OfdService.renderPage(abs, 0, PREVIEW_PPM);
                return new PreviewData(abs, pages, img);
            }

            @Override
            protected void done() {
                try {
                    PreviewData data = get();
                    currentFile = data.file;
                    pageCount = data.pages;
                    pageIndex = 0;
                    currentImage = data.image;
                    setTitle("OFD 预览 — " + data.file.getFileName());
                    paintPreview();
                    setConvertEnabled(true);
                    status("已打开: " + data.file + "（共 " + data.pages + " 页）");
                } catch (Exception ex) {
                    currentFile = null;
                    setConvertEnabled(false);
                    previewLabel.setIcon(null);
                    previewLabel.setText("打开失败");
                    error("无法打开 OFD", ex);
                }
            }
        }.execute();
    }

    private void showPage(int index) {
        if (currentFile == null) return;
        if (index < 0 || index >= pageCount) return;
        status("正在渲染第 " + (index + 1) + " 页…");
        final int target = index;
        new SwingWorker<BufferedImage, Void>() {
            @Override
            protected BufferedImage doInBackground() throws Exception {
                return OfdService.renderPage(currentFile, target, PREVIEW_PPM);
            }

            @Override
            protected void done() {
                try {
                    currentImage = get();
                    pageIndex = target;
                    paintPreview();
                    status("第 " + (pageIndex + 1) + " / " + pageCount + " 页");
                } catch (Exception ex) {
                    error("渲染失败", ex);
                }
            }
        }.execute();
    }

    private void paintPreview() {
        if (currentImage == null) return;
        int maxW = Math.max(800, getContentPane().getWidth() - 40);
        Image scaled = currentImage;
        if (currentImage.getWidth() > maxW) {
            int h = (int) (currentImage.getHeight() * (maxW / (double) currentImage.getWidth()));
            scaled = currentImage.getScaledInstance(maxW, h, Image.SCALE_SMOOTH);
        }
        previewLabel.setText(null);
        previewLabel.setIcon(new ImageIcon(scaled));
        pageLabel.setText("  " + (pageIndex + 1) + " / " + pageCount + "  ");
        prevBtn.setEnabled(pageIndex > 0);
        nextBtn.setEnabled(pageIndex + 1 < pageCount);
    }

    private void convertWithSaveDialog(String label) {
        if (currentFile == null) return;

        String ext = switch (label) {
            case "PDF" -> "pdf";
            case "PNG" -> "png";
            case "SVG" -> "svg";
            default -> throw new IllegalStateException("未知格式: " + label);
        };

        Path suggested = OfdService.sourceDir(currentFile)
                .resolve(OfdService.stem(currentFile) + "." + ext);
        Path chosen = chooseSavePath(label, ext, suggested);
        if (chosen == null) {
            status("已取消保存");
            return;
        }

        List<Path> targets = plannedOutputs(label, chosen, ext);
        if (!confirmOverwriteIfNeeded(targets)) {
            status("已取消保存");
            return;
        }

        runConvert(label, () -> {
            deleteExisting(targets);
            return switch (label) {
                case "PDF" -> OfdService.toPdf(currentFile, chosen);
                case "PNG" -> OfdService.toImages(currentFile, chosen, "png", 15);
                case "SVG" -> OfdService.toSvg(currentFile, chosen);
                default -> throw new IllegalStateException("未知格式: " + label);
            };
        });
    }

    /** @return chosen path, or null if user cancelled */
    private Path chooseSavePath(String label, String ext, Path suggested) {
        JFileChooser chooser = new JFileChooser();
        chooser.setDialogType(JFileChooser.SAVE_DIALOG);
        chooser.setDialogTitle("保存为 " + label);
        chooser.setApproveButtonText("保存");
        chooser.setSelectedFile(suggested.toFile());
        chooser.setCurrentDirectory(suggested.getParent() != null
                ? suggested.getParent().toFile()
                : new File("."));
        chooser.setFileFilter(new FileNameExtensionFilter(label + " (*." + ext + ")", ext));
        chooser.setAcceptAllFileFilterUsed(true);

        if (chooser.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) return null;

        Path chosen = chooser.getSelectedFile().toPath().toAbsolutePath().normalize();
        String name = chosen.getFileName().toString();
        if (!name.toLowerCase().endsWith("." + ext)) {
            chosen = chosen.resolveSibling(name + "." + ext);
        }
        return chosen;
    }

    private List<Path> plannedOutputs(String label, Path chosen, String ext) {
        if ("PDF".equals(label) || pageCount <= 1) {
            return List.of(chosen);
        }
        Path dir = chosen.getParent() != null ? chosen.getParent() : Path.of(".");
        String base = OfdService.stem(chosen);
        List<Path> list = new java.util.ArrayList<>();
        for (int i = 1; i <= pageCount; i++) {
            list.add(dir.resolve(String.format("%s-%03d.%s", base, i, ext)));
        }
        return list;
    }

    /** @return false if user cancelled overwrite */
    private boolean confirmOverwriteIfNeeded(List<Path> targets) {
        List<Path> existing = new java.util.ArrayList<>();
        for (Path p : targets) {
            if (Files.exists(p)) existing.add(p);
        }
        if (existing.isEmpty()) return true;

        StringBuilder msg = new StringBuilder("已存在同名文件，是否覆盖？\n\n");
        int show = Math.min(existing.size(), 8);
        for (int i = 0; i < show; i++) {
            msg.append("• ").append(existing.get(i).getFileName()).append('\n');
        }
        if (existing.size() > show) {
            msg.append("… 共 ").append(existing.size()).append(" 个文件\n");
        }
        msg.append("\n完整路径：\n").append(existing.get(0).getParent());

        int ans = JOptionPane.showConfirmDialog(
                this,
                msg.toString(),
                "同名文件",
                JOptionPane.YES_NO_OPTION,
                JOptionPane.WARNING_MESSAGE);
        return ans == JOptionPane.YES_OPTION;
    }

    private static void deleteExisting(List<Path> targets) throws Exception {
        for (Path p : targets) {
            try {
                Files.deleteIfExists(p);
            } catch (Exception ex) {
                throw new IOException("无法覆盖已存在的文件：\n" + p.getFileName()
                        + "\n\n请关闭占用该文件的程序后重试。\n（" + rootMessage(ex) + "）", ex);
            }
        }
    }

    private void runConvert(String label, ConvertTask task) {
        setConvertEnabled(false);
        status("正在转换 " + label + "…");
        new SwingWorker<Object, Void>() {
            @Override
            protected Object doInBackground() throws Exception {
                return task.run();
            }

            @Override
            protected void done() {
                setConvertEnabled(true);
                try {
                    Object result = get();
                    status("已生成 " + label + ": " + result);
                    JOptionPane.showMessageDialog(OfdApp.this,
                            "已保存:\n" + result,
                            "转换完成", JOptionPane.INFORMATION_MESSAGE);
                } catch (Exception ex) {
                    Throwable root = unwrap(ex);
                    if (looksLikeExistsConflict(root)) {
                        JOptionPane.showMessageDialog(OfdApp.this,
                                "已存在同名文件，且无法自动覆盖。\n\n"
                                        + rootMessage(root)
                                        + "\n\n请换一个文件名，或关闭占用该文件的程序后重试。",
                                "同名文件",
                                JOptionPane.WARNING_MESSAGE);
                        status("保存失败：同名文件无法覆盖");
                        return;
                    }
                    error("转换 " + label + " 失败", ex);
                }
            }
        }.execute();
    }

    private static boolean looksLikeExistsConflict(Throwable t) {
        String m = (t.getMessage() == null ? "" : t.getMessage()) + " " + t.getClass().getSimpleName();
        String lower = m.toLowerCase();
        return lower.contains("exist") || lower.contains("已经存在") || lower.contains("已存在")
                || lower.contains("fileexists") || lower.contains("accessdenied")
                || lower.contains("无法覆盖") || t instanceof java.nio.file.FileAlreadyExistsException;
    }

    private static Throwable unwrap(Throwable ex) {
        Throwable root = ex;
        if (root instanceof java.util.concurrent.ExecutionException && root.getCause() != null) {
            root = root.getCause();
        }
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        return root;
    }

    private static String rootMessage(Throwable ex) {
        Throwable root = unwrap(ex);
        String m = root.getMessage();
        return (m == null || m.isBlank()) ? root.getClass().getSimpleName() : m;
    }

    private void showText() {
        if (currentFile == null) return;
        status("正在提取文字…");
        new SwingWorker<String, Void>() {
            @Override
            protected String doInBackground() throws Exception {
                return OfdService.extractText(currentFile);
            }

            @Override
            protected void done() {
                try {
                    showTextDialog("提取文字", get());
                    status("文字提取完成");
                } catch (Exception ex) {
                    error("提取文字失败", ex);
                }
            }
        }.execute();
    }

    private void showInfo() {
        if (currentFile == null) return;
        try {
            showTextDialog("文档信息", OfdService.readInfo(currentFile).summary(currentFile));
        } catch (Exception ex) {
            error("读取信息失败", ex);
        }
    }

    private void showTextDialog(String title, String text) {
        JTextArea area = new JTextArea(text, 24, 60);
        area.setEditable(false);
        area.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 13));
        JOptionPane.showMessageDialog(this, new JScrollPane(area), title, JOptionPane.PLAIN_MESSAGE);
    }

    private void setConvertEnabled(boolean on) {
        boolean hasDoc = on && currentFile != null;
        pdfBtn.setEnabled(hasDoc);
        pngBtn.setEnabled(hasDoc);
        svgBtn.setEnabled(hasDoc);
        textBtn.setEnabled(hasDoc);
        infoBtn.setEnabled(hasDoc);
        prevBtn.setEnabled(hasDoc && pageIndex > 0);
        nextBtn.setEnabled(hasDoc && pageIndex + 1 < pageCount);
    }

    private void status(String msg) {
        statusLabel.setText(msg);
    }

    private void error(String title, Exception ex) {
        String msg = rootMessage(ex);
        status(title + ": " + msg);
        JOptionPane.showMessageDialog(this, msg, title, JOptionPane.ERROR_MESSAGE);
    }

    @FunctionalInterface
    private interface ConvertTask {
        Object run() throws Exception;
    }

    private record PreviewData(Path file, int pages, BufferedImage image) {}
}
