const exec = require('child_process').exec
const path = require('path')
const fs = require('fs')
const tmp = require('tmp')

function SalesforceDX(username, verbose = false) {
    if (!username) throw new Error('Missing username')
    this._verbose = verbose
    this._username = username

    this._logIfVerbose = (msg) => {
        if (this._verbose) this._log(msg)
    }
    this._log = (msg) => {
        console.log(`SFDX - ${msg}`)
    }
}

/**
 * Issue a bulk UPSERT request using SalesforceDX for the supplied object, using data 
 * from the supplied file
 * @param {String} objname 
 * @param {String} filename 
 * @param {String} externalId 
 */
SalesforceDX.prototype.bulkUpsert = function(objname, filename, externalId) {
    return this.bulkRequest(`sfdx force:data:bulk:upsert -u ${this._username} -s ${objname} -f ${filename} -i ${externalId}`, objname)
}

/**
 * Does a bulk delete of the supplied object using ID's from the supplied file
 * @param {*} objname 
 * @param {*} filename 
 */
SalesforceDX.prototype.bulkDelete = function(objname, filename) {
    return this.bulkRequest(`sfdx force:data:bulk:delete -u ${this._username} -s ${objname} -f ${filename}`, objname)
}

/**
 * Does a bulk request for the supplied object using SalesforceDX
 * @param {String} cmd 
 * @param {String} objname 
 */
SalesforceDX.prototype.bulkRequest = function(cmd, objname) {
    return new Promise((resolve, reject) => {
        this.executeSFDXCommand(cmd).then(data => {
            // check status
            if (data.status !== 0) return reject(new Error(`Received non-zero status code back, message: ${data.message}`))

            // get jobid and log
            const jobId = data.result[0].jobId
            this._log(`issued bulk request to object (${objname}) - jobId ${jobId}, batch count: ${data.result.length}`)
            this._logIfVerbose(JSON.stringify(data))

            // wait for all bulk operations to finish
            let doWait = () => {
                global.setTimeout(() => {
                    this._log(`asking for overall status for bulk jobId ${jobId}`)
                    this.executeSFDXCommand(`sfdx force:data:bulk:status -u ${this._username} --jobid ${jobId}`).then(data => {
                        // verify status
                        if (data.status !== 0) {
                            return reject(new Error(`hmmmmm - non-zero status when asking for status of bulk jobId ${jobId} - message: ${data.message}`))
                        }

                        // get data (convert to numbers)
                        let totalBatches = (data.result.numberBatchesTotal-0)
                        let totalDone = (data.result.numberBatchesCompleted-0) + (data.result.numberBatchesFailed-0)
                        this._logIfVerbose(`current bulk status, numberBatchesTotal: ${totalBatches}, numberBatchesCompleted: ${data.result.numberBatchesCompleted}, numberBatchesFailed: ${data.result.numberBatchesFailed}, numberBatchesQueued: ${data.result.numberBatchesQueued}, numberBatchesInProgress: ${data.result.numberBatchesInProgress}`)
                        if (totalDone !== totalBatches) {
                            this._log(`received bulk status and you're not going to like it - not done yet... ${totalDone} batches of ${totalBatches} are done (completed or failed) - continuing to wait...`)
                            return doWait()
                        }

                        // hurray we are done
                        this._log(`hurrah - it's what we've been waiting for - we're done!! (${data.result.totalProcessingTime} ms)`)
                        return resolve()
                    })
                }, 10000)
            }
            doWait()
        })
    })
}

/**
 * This is simply syntaxtic sugar on top of #executeSFDXCommand as it bascially just executes 
 * the query using force:data:soql:query.
 * 
 * @param {String} soql valid SOQL query or else...
 */
SalesforceDX.prototype.soqlQuery = function(soql) {
    // sanatize soql
    let sanatizedSoql = soql.replace(/"/g, "'")
    return this.executeSFDXCommand(`sfdx force:data:soql:query -u ${this._username} -q "${sanatizedSoql}"`)
}

/**
 * Does a query for Ids from the supplied object using the supplied 
 * SOQL WHERE query, pipes the result to a tmp-file to avoid stdin buffer 
 * overruns, creates a CSV file with the IDs a does a SalesforceDX bulk delete 
 * of the records.
 * 
 * @param {String} objname Object name to query i.e. Account
 * @param {String} where SOQL WHERE clause - must be specified
 */
SalesforceDX.prototype.bulkQueryAndDelete = function(objname, where) {
    return new Promise((resolve, reject) => {
        this._log(`issueing SOQL using WHERE clause of '${where}' on ${objname} object`)
        this.soqlQuery(`SELECT Id FROM ${objname} WHERE ${where}`).then(data => {
            let count = data.result.records.length
            this._log(`received ${count} records`)
            if (!count) {
                return reject()
            }
            
            // build output filename
            tmp.file((err, tmppath, fd, callback) => {
                const deleteIds = fs.createWriteStream(tmppath)
                deleteIds.write('"Id"\n')
                data.result.records.map(r => r.Id).forEach(id => {
                    deleteIds.write(`${id}\n`)
                })
                deleteIds.close()
                this._logIfVerbose(`wrote CSV file ${tmppath} with ${objname} Ids to delete`)

                // do command
                this.bulkDelete(objname, tmppath).then(() => {
                    resolve()
                }).catch(() => {
                    reject()
                }).then(() => {
                    // clean up tmp file
                    callback()
                })
            })
        })
    })
}

/**
 * Utility function to issue a call using SalesforceDX in the shell and returnsthe 
 * data as a JSON object. Method will append --json to the command if not specified.
 * @param {String} cmd 
 */
SalesforceDX.prototype.executeSFDXCommand = function(cmd) {
    this._logIfVerbose(`received command: ${cmd}`)
    let command = cmd
    if (cmd.indexOf(' --json') < 0) {
        command += ' --json'
        this._logIfVerbose(`command (modified): ${command}`)
    }
    return new Promise((resolve, reject) => {
        // as output may exceed the node.js stdin buffer size we create a tmp file we 
        // pipe the ouput to and read that back in
        tmp.file((err, tmppath, fd, callback) => {
            command += ` > ${tmppath}`
            exec(command, (err, stdout, stderr) => {
                if (err) {
                    this._logIfVerbose('command resulted in error in shell')
                    return reject(err)
                }
                
                // read file
                let input = fs.readFileSync(tmppath).toString()

                // parse
                this._logIfVerbose('command succeeded in shell')
                let output = JSON.parse(input)

                // we're done with tmp file
                callback()

                // resolve
                resolve(output)
            })
        })
    
        
    })
}

/**
 * Queries force:org:display to ensure the supplied username is valid for a connected 
 * org.
 */
SalesforceDX.prototype.ensureOrgConnected = function() {
    return new Promise((resolve, reject) => {
        this.executeSFDXCommand(`sfdx force:org:display -u ${this._username}`).then(data => {
            if (data.result.connectedStatus !== 'Connected') {
                return reject(data.result.connectedStatus)
            } else {
                return resolve()
            }
        }).catch(err => {
            reject(err)
        })
    })
}

module.exports = SalesforceDX
