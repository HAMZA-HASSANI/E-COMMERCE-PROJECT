const request = require('supertest');
const { Pool } = require('pg');
const redis = require('redis');

// Mock PostgreSQL and Redis before requiring the app
jest.mock('pg', () => {
  const mPool = {
    query: jest.fn(),
    on: jest.fn(),
    end: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

jest.mock('redis', () => {
  const mClient = {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(),
    get: jest.fn(),
    setEx: jest.fn(),
    keys: jest.fn(),
    del: jest.fn(),
    quit: jest.fn(),
  };
  return { createClient: jest.fn(() => mClient) };
});

const app = require('../src/index');

describe('Product Service Endpoints', () => {
  let pool;
  
  beforeAll(() => {
    pool = new Pool();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should get a list of products', async () => {
    const mockProducts = [
      { id: 1, name: 'Test Product', price: 99.99, stock: 10 }
    ];
    
    // First query is COUNT, second is SELECT
    pool.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: mockProducts });

    const res = await request(app).get('/');
    
    expect(res.statusCode).toEqual(200);
    expect(res.body.products).toHaveLength(1);
    expect(res.body.products[0].name).toBe('Test Product');
    expect(res.body.pagination.total).toBe(1);
  });

  it('should return 400 for invalid product creation', async () => {
    const res = await request(app)
      .post('/')
      .send({
        name: '', // Invalid name
        price: -5 // Invalid price
      });
      
    expect(res.statusCode).toEqual(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should return 404 for non-existent product', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/999');
    
    expect(res.statusCode).toEqual(404);
    expect(res.body).toHaveProperty('error', 'Product not found');
  });
});
