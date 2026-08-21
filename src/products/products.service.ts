import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product, ProductStatus } from './entities/product.entity';

interface CreateProductParams {
  name: string;
  providerCode: string;
  basePrice: number;
  sellingPrice: number;
  coinAmount: number;
  bonusCoin?: number;
  flag?: string;
}

interface UpdateProductParams {
  name?: string;
  providerCode?: string;
  basePrice?: number;
  sellingPrice?: number;
  coinAmount?: number;
  bonusCoin?: number;
  flag?: string;
  status?: ProductStatus;
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  async findActiveByIdOrFail(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id, status: ProductStatus.ACTIVE },
    });

    if (!product) {
      throw new NotFoundException(`Product ${id} not found or inactive`);
    }

    return product;
  }

  async findByIdOrFail(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  async findAll(): Promise<Product[]> {
    return this.productRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findAllActive(): Promise<Product[]> {
    return this.productRepository.find({
      where: { status: ProductStatus.ACTIVE },
      order: { createdAt: 'DESC' },
    });
  }

  async create(params: CreateProductParams): Promise<Product> {
    const product = this.productRepository.create({
      name: params.name,
      providerCode: params.providerCode,
      basePrice: params.basePrice.toFixed(2),
      sellingPrice: params.sellingPrice.toFixed(2),
      coinAmount: params.coinAmount.toFixed(2),
      bonusCoin: (params.bonusCoin ?? 0).toFixed(2),
      flag: params.flag ?? null,
    });
    return this.productRepository.save(product);
  }

  async update(id: string, params: UpdateProductParams): Promise<Product> {
    const product = await this.findByIdOrFail(id);

    if (params.name !== undefined) product.name = params.name;
    if (params.providerCode !== undefined)
      product.providerCode = params.providerCode;
    if (params.basePrice !== undefined)
      product.basePrice = params.basePrice.toFixed(2);
    if (params.sellingPrice !== undefined)
      product.sellingPrice = params.sellingPrice.toFixed(2);
    if (params.coinAmount !== undefined)
      product.coinAmount = params.coinAmount.toFixed(2);
    if (params.bonusCoin !== undefined)
      product.bonusCoin = params.bonusCoin.toFixed(2);
    if (params.flag !== undefined) product.flag = params.flag;
    if (params.status !== undefined) product.status = params.status;

    return this.productRepository.save(product);
  }

  /**
   * Soft delete: sets deleted_at instead of removing the row, so past
   * transactions that reference this product (product_id FK) keep working.
   * TypeORM automatically excludes soft-deleted rows from find/findOne, so
   * a deleted product disappears from every listing without further code
   * changes here.
   */
  async softDelete(id: string): Promise<void> {
    await this.findByIdOrFail(id);
    await this.productRepository.softDelete(id);
  }
}
