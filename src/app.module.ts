import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Product } from './products/entities/product.entity';
import { Transaction } from './transactions/entities/transaction.entity';
import { TopupModule } from './topup/topup.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AffiliatesModule } from './affiliates/affiliates.module';
import { SettingsModule } from './settings/settings.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.getOrThrow<string>('DB_USERNAME'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_NAME'),
        entities: [Product, Transaction],
        autoLoadEntities: true,
        // Dev-only convenience; replace with TypeORM migrations before
        // any shared/staging/production database is used.
        synchronize:
          config.get<string>('NODE_ENV', 'development') !== 'production',
      }),
    }),
    TopupModule,
    UsersModule,
    AuthModule,
    AffiliatesModule,
    SettingsModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
