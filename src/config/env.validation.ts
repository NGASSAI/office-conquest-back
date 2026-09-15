import * as Joi from 'joi';

// Validation stricte des variables d'environnement au démarrage — l'app refuse de démarrer si une est manquante/invalide
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(4000),
  DATABASE_URL: Joi.string().uri().required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRATION: Joi.string().default('30d'),
  FRONTEND_URL: Joi.string().uri().required(),
  DEFAULT_ENERGY_THRESHOLD: Joi.number().default(1000),
});
