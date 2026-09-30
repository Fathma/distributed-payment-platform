# Kafka

Docker Compose runs a single-node Kafka KRaft broker for local development. A one-shot volume initializer grants the broker's container user write access to the named data volume. The `kafka-init` one-shot service creates the initial six-partition topics after the broker is healthy. The single broker and replication factor of one are for development only, not production availability.
