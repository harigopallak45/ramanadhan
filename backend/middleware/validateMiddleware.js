const { validationResult } = require('express-validator');

const validateMiddleware = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Only return generic/safe error messages, avoid exposing sensitive db info
    const extractedErrors = [];
    errors.array().map(err => extractedErrors.push({ [err.path]: err.msg }));

    return res.status(400).json({
      errors: extractedErrors
    });
  }
  next();
};

module.exports = validateMiddleware;
