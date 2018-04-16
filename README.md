# SalesforceDX Bulk Helper
These are thin wrappers around the SalesforceDX Bulk API capabilities to allow you to easily build scripts can manipulate data in Salesforce orgs using the Bulk API. You may perform UPSERT's and DELETE's using the Bulk API.

## Bulk UPSERT
Bulk API UPSERT is done by initializing the SalesforceDX object using the username from SalesforceDX to use, and then calling `bulkUpsert`supplying the object to UPSERT, the filename with data and the name of the external key field to use. Specify 'Id' if not using any other external ID.
```
let sfdx = new SalesforceDX('foo@example.com')
sfdx.bulkUpsert('Account', 'my_account_data.csv', 'Id').then(() => {
    console.log('Done')
}).catch(() => {
    console.log('Not so good...')
})
```

## Bulk DELETE
Bulk API DELETE is done by initializing the SalesforceDX object using the username from SalesforceDX to use, and then calling `bulkDelete`supplying the object to DELETE and a filename with IDs to delete. Be sure to specify a header in the CSV file.
```
let sfdx = new SalesforceDX('foo@example.com')
sfdx.bulkDelete('Account', 'my_account_data.csv').then(() => {
    console.log('Done')
}).catch(() => {
    console.log('Not so good...')
})
```

Optionally you may perform a query'n'delete operation using the `bulkQueryAndDelete` method. Here you specify the name of the object to query for and the SOQL WHERE clause to select records. The code will query for the record IDs and then forward the call to `bulkDelete`.
```
let sfdx = new SalesforceDX('foo@example.com')
sfdx.bulkQueryAndDelete('Account', 'LastName="Smith"').then(() => {
    console.log('Done')
}).catch(() => {
    console.log('Not so good...')
})
```