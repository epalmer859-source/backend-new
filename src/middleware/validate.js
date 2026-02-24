function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const first = result.error.errors[0];
      const message = first ? `${first.path.join('.')}: ${first.message}` : 'Validation failed';
      return res.status(400).json({ error: message });
    }
    req.body = result.data;
    next();
  };
}

module.exports = validate;
