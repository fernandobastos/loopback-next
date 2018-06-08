// Copyright IBM Corp. 2017,2018. All Rights Reserved.
// Node module: @loopback/repository
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

import {
  model,
  property,
  Entity,
  DefaultCrudRepository,
  juggler,
  EntityCrudRepository,
  hasManyRepositoryFactory,
  HasManyDefinition,
  RelationType,
  HasManyEntityCrudRepository,
} from '../..';
import {expect} from '@loopback/testlab';

describe('HasMany relation', () => {
  // Given a Customer and Order models - see definitions at the bottom

  beforeEach(givenCrudRepositoriesForCustomerAndOrder);

  let existingCustomerId: number;
  //FIXME: this should be inferred from relational decorators
  let customerHasManyOrdersRelationMeta: HasManyDefinition;
  let customerOrders: HasManyEntityCrudRepository<Order>;

  beforeEach(async () => {
    existingCustomerId = (await givenPersistedCustomerInstance()).id;
    customerHasManyOrdersRelationMeta = givenHasManyRelationMetadata();
    // Ideally, we would like to write
    // customerRepo.orders.create(customerId, orderData);
    // or customerRepo.orders({id: customerId}).*
    // The initial "involved" implementation is below

    //FIXME: should be automagically instantiated via DI or other means
    customerOrders = hasManyRepositoryFactory(
      existingCustomerId,
      customerHasManyOrdersRelationMeta,
      orderRepo,
    );
  });

  it('can create an instance of the related model', async () => {
    const description = 'an order desc';
    const order = await customerOrders.create({description});

    expect(order.toObject()).to.containDeep({
      customerId: existingCustomerId,
      description,
    });
    const persisted = await orderRepo.findById(order.id);
    expect(persisted.toObject()).to.deepEqual(order.toObject());
  });

  it('can patch many instances', async () => {
    await createSamples();
    await testPatch();

    async function testPatch() {
      const patchObject = {description: 'new order'};
      const arePatched = await customerOrders.patch(patchObject);
      // tslint:disable-next-line: no-unused-expression
      expect(arePatched).to.equal(2);
      const patchedItems = await customerOrders.find();
      expect(patchedItems).to.have.length(2);
      patchedItems.forEach(order => {
        expect(order.description).to.eql('new order');
        expect(order.customerId).to.eql(existingCustomerId);
      });
    }
  });

  it('can delete many instances', async () => {
    await createSamples();
    await testDelete();

    async function testDelete() {
      const deletedOrders = await customerOrders.delete();
      // tslint:disable-next-line: no-unused-expression
      expect(deletedOrders).to.equal(2);
      const relatedOrders = await customerOrders.find();
      // tslint:disable-next-line: no-unused-expression
      expect(relatedOrders).to.be.empty;
    }
  });

  async function createSamples() {
    const samples = [{description: 'order 1'}, {description: 'order 2'}];
    await customerOrders.create(samples[0]);
    await customerOrders.create(samples[1]);
  }
  // This should be enforced by the database to avoid race conditions
  it.skip('reject create request when the customer does not exist');

  //--- HELPERS ---//

  @model()
  class Customer extends Entity {
    @property({
      type: 'number',
      id: true,
    })
    id: number;

    @property({
      type: 'string',
    })
    name: string;
  }

  @model()
  class Order extends Entity {
    @property({
      type: 'number',
      id: true,
    })
    id: number;

    @property({
      type: 'string',
      required: true,
    })
    description: string;

    @property({
      type: 'boolean',
      required: false,
    })
    isDelivered: boolean;

    @property({
      type: 'number',
      required: true,
    })
    customerId: number;
  }

  let customerRepo: EntityCrudRepository<
    Customer,
    typeof Customer.prototype.id
  >;
  let orderRepo: EntityCrudRepository<Order, typeof Order.prototype.id>;
  function givenCrudRepositoriesForCustomerAndOrder() {
    const db = new juggler.DataSource({connector: 'memory'});

    customerRepo = new DefaultCrudRepository(Customer, db);
    orderRepo = new DefaultCrudRepository(Order, db);
  }

  async function givenPersistedCustomerInstance() {
    return customerRepo.create({name: 'a customer'});
  }

  function givenHasManyRelationMetadata(): HasManyDefinition {
    return {
      keyTo: 'customerId',
      type: RelationType.hasMany,
    };
  }
});
