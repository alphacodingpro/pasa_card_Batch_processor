import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType, HTMLCanvasElementLuminanceSource, BinaryBitmap, HybridBinarizer } from '@zxing/library';
import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';

async function run() {
    const reader = new BrowserMultiFormatReader();
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    
    // Read user's uploaded image
    // Note: Provide the correct filename or check artifact directory
    const files = fs.readdirSync('/Users/mac/.gemini/antigravity/brain/482c6741-f62f-44b5-8018-7a16bc905c49/');
    const imgFile = files.find(f => f.endsWith('.jpg') && f.startsWith('media'));
    if (!imgFile) { console.log("Image not found"); return; }
    const path = '/Users/mac/.gemini/antigravity/brain/482c6741-f62f-44b5-8018-7a16bc905c49/' + imgFile;
    console.log("Testing:", path);
    const image = await loadImage(path);
    
    let canvas = createCanvas(image.width, image.height);
    let ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    
    try {
        // ZXing core method using canvas
        const source = new HTMLCanvasElementLuminanceSource(canvas);
        const bitmap = new BinaryBitmap(new HybridBinarizer(source));
        const result = reader.reader.decode(bitmap, hints);
        console.log("Detected Full:", result.getText());
    } catch(e) {
        console.log("Full image failed");
    }

    // Try regions
    const regions = [
      { name: 'Half1', x: 0, y: 0, w: 1, h: 0.5 },
      { name: 'Half2', x: 0, y: 0.5, w: 1, h: 0.5 },
      { name: 'Left Half', x: 0, y: 0, w: 0.5, h: 1 },
      { name: 'Right Half', x: 0.5, y: 0, w: 0.5, h: 1 },
    ];
    for (const r of regions) {
        let rc = createCanvas(image.width * r.w, image.height * r.h);
        let rx = rc.getContext('2d');
        rx.drawImage(image, r.x * image.width, r.y * image.height, rc.width, rc.height, 0, 0, rc.width, rc.height);
        try {
            const source = new HTMLCanvasElementLuminanceSource(rc);
            const bitmap = new BinaryBitmap(new HybridBinarizer(source));
            const result = reader.reader.decode(bitmap, hints);
            console.log("Detected in region:", r.name, result.getText());
        } catch(e) { }
    }
}
run();
