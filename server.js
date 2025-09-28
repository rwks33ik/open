const express = require('express');
const qr = require('qr-image');
const { createCanvas } = require('canvas');
const Jimp = require('jimp');
const jsQR = require('jsqr');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// مجلد للصور المؤقتة
if (!fs.existsSync('temp')) {
    fs.mkdirSync('temp');
}

// 📍 صفحة الرئيسية
app.get('/', (req, res) => {
    res.json({
        message: '🚀 API لإنشاء وقراءة الباركود',
        endpoints: {
            createQR: 'POST /api/create-qr',
            readQR: 'POST /api/read-qr',
            createBarcode: 'POST /api/create-barcode',
            health: 'GET /api/health'
        },
        author: '@QR_l4'
    });
});

// 📍 فحص حالة API
app.get('/api/health', (req, res) => {
    res.json({ 
        status: '✅ يعمل', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// 📍 إنشاء QR Code
app.post('/api/create-qr', async (req, res) => {
    try {
        const { text, size = 300, margin = 1 } = req.body;

        if (!text) {
            return res.status(400).json({ 
                error: 'النص مطلوب لإنشاء QR Code' 
            });
        }

        // إنشاء QR Code
        const qr_png = qr.imageSync(text, { 
            type: 'png', 
            size: parseInt(size),
            margin: parseInt(margin)
        });

        const base64 = qr_png.toString('base64');
        const dataUrl = `data:image/png;base64,${base64}`;

        res.json({
            success: true,
            message: '✅ تم إنشاء QR Code بنجاح',
            data: {
                text: text,
                image: dataUrl,
                size: size,
                download_url: `${req.protocol}://${req.get('host')}/api/download-qr?text=${encodeURIComponent(text)}&size=${size}`
            }
        });

    } catch (error) {
        console.error('Error creating QR:', error);
        res.status(500).json({ 
            error: 'فشل في إنشاء QR Code',
            details: error.message 
        });
    }
});

// 📍 تحميل QR Code كصورة
app.get('/api/download-qr', (req, res) => {
    try {
        const { text, size = 300, margin = 1 } = req.query;

        if (!text) {
            return res.status(400).send('النص مطلوب');
        }

        const qr_png = qr.imageSync(text, { 
            type: 'png', 
            size: parseInt(size),
            margin: parseInt(margin)
        });

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="qrcode-${Date.now()}.png"`);
        res.send(qr_png);

    } catch (error) {
        res.status(500).send('فشل في إنشاء QR Code');
    }
});

// 📍 قراءة QR Code من صورة
app.post('/api/read-qr', async (req, res) => {
    try {
        const { image } = req.body;

        if (!image) {
            return res.status(400).json({ 
                error: 'الصورة مطلوبة (base64 أو URL)' 
            });
        }

        let imageBuffer;

        // إذا كانت base64
        if (image.startsWith('data:image')) {
            const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
            imageBuffer = Buffer.from(base64Data, 'base64');
        } 
        // إذا كانت URL
        else if (image.startsWith('http')) {
            const response = await fetch(image);
            const arrayBuffer = await response.arrayBuffer();
            imageBuffer = Buffer.from(arrayBuffer);
        } 
        else {
            return res.status(400).json({ 
                error: 'صيغة الصورة غير مدعومة' 
            });
        }

        // تحميل الصورة باستخدام Jimp
        const jimpImage = await Jimp.read(imageBuffer);
        const imageData = {
            data: new Uint8ClampedArray(jimpImage.bitmap.data),
            width: jimpImage.bitmap.width,
            height: jimpImage.bitmap.height
        };

        // قراءة QR Code
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code) {
            res.json({
                success: true,
                message: '✅ تم قراءة QR Code بنجاح',
                data: {
                    text: code.data,
                    chunks: code.chunks,
                    version: code.version,
                    location: code.location
                }
            });
        } else {
            res.json({
                success: false,
                message: '❌ لم يتم العثور على QR Code في الصورة',
                data: null
            });
        }

    } catch (error) {
        console.error('Error reading QR:', error);
        res.status(500).json({ 
            error: 'فشل في قراءة QR Code',
            details: error.message 
        });
    }
});

// 📍 إنشاء Barcode (شريطي)
app.post('/api/create-barcode', async (req, res) => {
    try {
        const { text, width = 400, height = 200 } = req.body;

        if (!text) {
            return res.status(400).json({ 
                error: 'النص مطلوب لإنشاء Barcode' 
            });
        }

        // إنشاء باركود بسيط (يمكن استبداله بمكتبة متخصصة)
        const canvas = createCanvas(parseInt(width), parseInt(height));
        const ctx = canvas.getContext('2d');

        // خلفية بيضاء
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);

        // إنشاء نمط شريطي بسيط
        ctx.fillStyle = 'black';
        const barWidth = 2;
        let x = 10;

        for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i);
            
            // تحويل الحرف إلى نمط شريطي بسيط
            for (let j = 0; j < 8; j++) {
                if (charCode & (1 << j)) {
                    ctx.fillRect(x, 50, barWidth, height - 100);
                }
                x += barWidth;
            }
            x += 2; // مسافة بين الحروف
        }

        // إضافة النص أسفل الباركود
        ctx.fillStyle = 'black';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(text, width / 2, height - 20);

        const buffer = canvas.toBuffer('image/png');
        const base64 = buffer.toString('base64');
        const dataUrl = `data:image/png;base64,${base64}`;

        res.json({
            success: true,
            message: '✅ تم إنشاء Barcode بنجاح',
            data: {
                text: text,
                image: dataUrl,
                width: width,
                height: height
            }
        });

    } catch (error) {
        console.error('Error creating barcode:', error);
        res.status(500).json({ 
            error: 'فشل في إنشاء Barcode',
            details: error.message 
        });
    }
});

// 📍 رفع صورة وقراءة QR Code منها
app.post('/api/upload-read-qr', async (req, res) => {
    try {
        if (!req.files || !req.files.image) {
            return res.status(400).json({ 
                error: 'الصورة مطلوبة' 
            });
        }

        const imageFile = req.files.image;
        const tempPath = path.join(__dirname, 'temp', `${Date.now()}-${imageFile.name}`);
        
        await imageFile.mv(tempPath);

        // قراءة QR Code من الملف
        const jimpImage = await Jimp.read(tempPath);
        const imageData = {
            data: new Uint8ClampedArray(jimpImage.bitmap.data),
            width: jimpImage.bitmap.width,
            height: jimpImage.bitmap.height
        };

        const code = jsQR(imageData.data, imageData.width, imageData.height);

        // حذف الملف المؤقت
        fs.unlinkSync(tempPath);

        if (code) {
            res.json({
                success: true,
                message: '✅ تم قراءة QR Code بنجاح',
                data: {
                    text: code.data,
                    version: code.version
                }
            });
        } else {
            res.json({
                success: false,
                message: '❌ لم يتم العثور على QR Code في الصورة'
            });
        }

    } catch (error) {
        console.error('Error uploading QR:', error);
        res.status(500).json({ 
            error: 'فشل في قراءة QR Code',
            details: error.message 
        });
    }
});

// 📍 معالجة الأخطاء
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        error: 'حدث خطأ في الخادم',
        details: err.message 
    });
});

// 📍 404 - Not Found
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Endpoint غير موجود',
        available_endpoints: [
            'GET /',
            'GET /api/health',
            'POST /api/create-qr',
            'GET /api/download-qr',
            'POST /api/read-qr',
            'POST /api/create-barcode'
        ]
    });
});

// بدء الخادم
app.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على http://localhost:${PORT}`);
    console.log(`📧 المطور: @QR_l4`);
});

module.exports = app;
