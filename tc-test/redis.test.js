const { GenericContainer } = require('testcontainers');

jest.setTimeout(180000);

test('starts a redis container via testcontainers', async () => {
  const container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .start();

  expect(container.getMappedPort(6379)).toBeGreaterThan(0);

  await container.stop();
});
