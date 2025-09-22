## Parameter store (2 marks)

This criterion is about appropriately using Parameter store for storing relevant data for your application. For example,

    Application URL (often required by the front end for accessing your app's API)
    External API URL or other information

## Secrets manager (2 marks)

This criterion is about appropriately using Secrets manager for storing relevant data for your application. For example,

    External API access keys
    Database credentials

## In-memory caching (3 marks)

This criteria is about your appropriate use of in-memory caching for database queries or external APIs using memcached on Elasticache.

You should have a convincing reason that the data you are caching will be accessed frequently. This does not have to be true now but it should be true in an imagined wide-scale deployment of your application.

## Infrastructure as Code (3 marks)

For this criterion you should aim to deploy all AWS services via IaC mechanisms. That includes infrastructure as code technologies for deployment of cloud services supporting core and additional criteria. We will not assess IaC use for deploying services related to assessment 1.

You can use Terraform, AWS CDK, or CloudFormation. For other technologies, please ask the teaching team.

Since using Docker compose for deploying multiple containers and IaC for EC2 were evaluated in assessment 1, this criterion only applies to services beyond these two cases. You can still use Docker compose if you like, but it will not count towards this criterion.

## Identity management: MFA (2 marks)

For this criterion, you should make appropriate and non-trivial use of additional Cognito functionality: multi-factor authentication.

If you want to use other Cognito functionality, please discuss with the teaching team, as not everything will be possible in our AWS environment.

## Identity management: federated identities (2 marks)

For this criterion, you should make appropriate and non-trivial use of additional Cognito functionality: federated identities, eg. Google, Facebook, etc.

If you want to use other Cognito functionality, please discuss with the teaching team, as not everything will be possible in our AWS environment.

## Identity management: user groups (2 marks)

For this criterion, you should make appropriate and non-trivial use of additional Cognito functionality: user groups for organising permissions, eg. an "Admin" group that has additional permissions in your application.

If you want to use other Cognito functionality, please discuss with the teaching team, as not everything will be possible in our AWS environment.

## Additional persistence service (3 marks)

This criteria can gain you marks for incorporating a third and distinct type of data persistence service from the category list in the Persistence services section, above.

There must be a compelling reason why this additional service is required/beneficial for your application; your application must take advantage of functionality that is not available in the other two services and is appropriate for the data that you are storing.

## S3 Pre-signed URLs (2 marks)

This criteria is about using S3 pre-signed URLs for direct client upload and download.

Where a client needs to send or receive an object stored in S3, this is done by passing a pre-signed URL to the client which then up/downloads the object directly from S3.

## Graceful handling of persistent connections (2 marks)

If your application uses persistent connections, such as server-side-events or websockets, in an appropriate way (eg. to allow for push style notifications or progress reporting rather than less efficient polling) then you need to address how this stateful aspect of your application impacts on the overall stateless design.

    Your application should gracefully handle the loss of persistent connections. Such a loss may be due to an instance of your server being shut down as the application scales in.
    For full marks, your application should show minimal to no degradation in functionality, for example by the client detecting the lost connection and re-establishing the connection (assuming that there is an instance of your server to serve the connection). Note that this means that whichever instance of your server serves the connection it will need to have access to whatever information is required to send to the client (eg. progress information)
    Part marks will be awarded for graceful degradation of functionality that has some effect but does not impact on the basic functionality of the application (eg. progress reporting stops and an error is reported, but the application otherwise functions correctly)
