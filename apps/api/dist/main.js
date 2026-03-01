"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const common_1 = require("@nestjs/common");
const helmet_1 = __importDefault(require("helmet"));
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        logger: process.env.NODE_ENV === 'production'
            ? ['error', 'warn']
            : ['log', 'error', 'warn', 'debug'],
    });
    app.use((0, helmet_1.default)({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:', 'https:'],
                connectSrc: ["'self'"],
                frameSrc: ["'none'"],
                objectSrc: ["'none'"],
                upgradeInsecureRequests: [],
            },
        },
        crossOriginEmbedderPolicy: false,
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
        xFrameOptions: { action: 'deny' },
        xContentTypeOptions: true,
        referrerPolicy: { policy: 'strict-origin' },
        permittedCrossDomainPolicies: false,
    }));
    app.useBodyParser('json', { limit: '5mb' });
    app.useBodyParser('urlencoded', { limit: '5mb', extended: true });
    app.enableCors({
        origin: (origin, callback) => {
            if (!origin)
                return callback(null, true);
            if (/\.railway\.app$/.test(origin) ||
                /\.cambobia\.com$/.test(origin) ||
                /^http:\/\/localhost(:\d+)?$/.test(origin) ||
                /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
                return callback(null, true);
            }
            callback(new Error(`CORS: origin ${origin} is not allowed`));
        },
        credentials: true,
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
        allowedHeaders: 'Content-Type,Accept,Authorization',
        maxAge: 86400,
    });
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
    }));
    const port = process.env.PORT || 3001;
    await app.listen(port);
    common_1.Logger.log(`🔐 API running on port ${port} with security hardening enabled`);
}
bootstrap().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=main.js.map