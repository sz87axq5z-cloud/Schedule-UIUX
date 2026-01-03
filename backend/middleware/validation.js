/**
 * 入力バリデーションミドルウェア
 *
 * Joiを使用してリクエストボディを検証
 */

const Joi = require('joi');

/**
 * バリデーションミドルウェアを生成
 */
function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false, // すべてのエラーを返す
      stripUnknown: true // 未知のフィールドを削除
    });

    if (error) {
      const errors = error.details.map(detail => detail.message);
      return res.status(400).json({
        success: false,
        error: 'バリデーションエラー',
        details: errors
      });
    }

    // 検証済みの値でreq.bodyを置き換え
    req.body = value;
    next();
  };
}

// ========================================
// スケジュール関連のスキーマ
// ========================================

const scheduleCreateSchema = Joi.object({
  title: Joi.string()
    .min(1)
    .max(100)
    .required()
    .messages({
      'string.empty': 'タイトルは必須です',
      'string.max': 'タイトルは100文字以内で入力してください',
      'any.required': 'タイトルは必須です'
    }),

  startTime: Joi.string()
    .isoDate()
    .required()
    .messages({
      'string.isoDate': '開始時間の形式が正しくありません',
      'any.required': '開始時間は必須です'
    }),

  endTime: Joi.string()
    .isoDate()
    .required()
    .messages({
      'string.isoDate': '終了時間の形式が正しくありません',
      'any.required': '終了時間は必須です'
    }),

  // 場所（片付けコーチング用）
  location: Joi.string()
    .max(100)
    .allow(null, '')
    .optional()
    .messages({
      'string.max': '場所は100文字以内で入力してください'
    }),

  locationIcon: Joi.string()
    .max(10)
    .allow(null, '')
    .optional(),

  studentId: Joi.string()
    .max(200)
    .allow(null, '')
    .optional(),

  studentName: Joi.string()
    .max(100)
    .allow(null, '')
    .optional()
    .messages({
      'string.max': '生徒名は100文字以内で入力してください'
    }),

  teacherId: Joi.string()
    .max(200)
    .allow(null, '')
    .optional(),

  teacherName: Joi.string()
    .max(100)
    .allow(null, '')
    .optional()
    .messages({
      'string.max': '講師名は100文字以内で入力してください'
    })
}).custom((value, helpers) => {
  // 開始時間が終了時間より前であることを確認
  const start = new Date(value.startTime);
  const end = new Date(value.endTime);

  if (start >= end) {
    return helpers.error('custom.timeOrder');
  }

  return value;
}).messages({
  'custom.timeOrder': '開始時間は終了時間より前に設定してください'
});

// 複数スケジュール一括登録用スキーマ（ウィザード用）
const scheduleBulkCreateSchema = Joi.object({
  schedules: Joi.array()
    .items(Joi.object({
      location: Joi.string()
        .min(1)
        .max(100)
        .required()
        .messages({
          'string.empty': '場所は必須です',
          'string.max': '場所は100文字以内で入力してください'
        }),

      locationIcon: Joi.string()
        .max(10)
        .allow(null, '')
        .optional(),

      startTime: Joi.string()
        .isoDate()
        .required()
        .messages({
          'string.isoDate': '開始時間の形式が正しくありません',
          'any.required': '開始時間は必須です'
        }),

      endTime: Joi.string()
        .isoDate()
        .required()
        .messages({
          'string.isoDate': '終了時間の形式が正しくありません',
          'any.required': '終了時間は必須です'
        })
    }).custom((value, helpers) => {
      const start = new Date(value.startTime);
      const end = new Date(value.endTime);
      if (start >= end) {
        return helpers.error('custom.timeOrder');
      }
      return value;
    }))
    .min(1)
    .max(20)
    .required()
    .messages({
      'array.min': '少なくとも1つのスケジュールが必要です',
      'array.max': '一度に登録できるのは20件までです',
      'any.required': 'スケジュールは必須です'
    }),

  studentId: Joi.string()
    .max(200)
    .allow(null, '')
    .optional(),

  studentName: Joi.string()
    .max(100)
    .allow(null, '')
    .optional()
}).messages({
  'custom.timeOrder': '開始時間は終了時間より前に設定してください'
});

const scheduleUpdateSchema = Joi.object({
  title: Joi.string()
    .min(1)
    .max(100)
    .optional()
    .messages({
      'string.empty': 'タイトルは空にできません',
      'string.max': 'タイトルは100文字以内で入力してください'
    }),

  startTime: Joi.string()
    .isoDate()
    .optional()
    .messages({
      'string.isoDate': '開始時間の形式が正しくありません'
    }),

  endTime: Joi.string()
    .isoDate()
    .optional()
    .messages({
      'string.isoDate': '終了時間の形式が正しくありません'
    }),

  studentId: Joi.string()
    .max(200)
    .allow(null, '')
    .optional(),

  studentName: Joi.string()
    .max(100)
    .allow(null, '')
    .optional(),

  teacherId: Joi.string()
    .max(200)
    .allow(null, '')
    .optional(),

  teacherName: Joi.string()
    .max(100)
    .allow(null, '')
    .optional(),

  status: Joi.string()
    .valid('scheduled', 'completed', 'cancelled')
    .optional()
});

// ========================================
// 認証関連のスキーマ
// ========================================

const roleUpdateSchema = Joi.object({
  role: Joi.string()
    .valid('student', 'teacher')
    .required()
    .messages({
      'any.only': '役割は student または teacher を指定してください',
      'any.required': '役割は必須です'
    })
});

const displayNameSchema = Joi.object({
  displayName: Joi.string()
    .min(1)
    .max(50)
    .required()
    .messages({
      'string.empty': '表示名は必須です',
      'string.max': '表示名は50文字以内で入力してください',
      'any.required': '表示名は必須です'
    })
});

// ========================================
// LINE通知関連のスキーマ
// ========================================

const linkCodeSchema = Joi.object({
  userId: Joi.string()
    .required()
    .messages({
      'any.required': 'userIdは必須です'
    })
});

const customerNameSchema = Joi.object({
  displayName: Joi.string()
    .min(1)
    .max(100)
    .required()
    .messages({
      'string.empty': '表示名は必須です',
      'string.max': '表示名は100文字以内で入力してください',
      'any.required': '表示名は必須です'
    })
});

// エクスポート
module.exports = {
  validate,
  schemas: {
    scheduleCreate: scheduleCreateSchema,
    scheduleBulkCreate: scheduleBulkCreateSchema,
    scheduleUpdate: scheduleUpdateSchema,
    roleUpdate: roleUpdateSchema,
    displayName: displayNameSchema,
    linkCode: linkCodeSchema,
    customerName: customerNameSchema
  }
};
