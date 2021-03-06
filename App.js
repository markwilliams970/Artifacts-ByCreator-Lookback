Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    items: [
        {
            xtype: 'container',
            itemId: 'controlsContainer',
            columnWidth: 1
        },
        {
            xtype: 'container',
            itemId: 'gridContainer',
            columnWidth: 1
        }
    ],

    _artifactTypeCombobox: null,
    _selectedArtifactType: null,
    _currentUser: null,
    _currentUserName: null,
    _snapshotStore: null,
    _artifactRecords: [],
    _artifactCreatorsByArtifactOID: {},
    _usersByUserOID: null,
    _artifactGrid: null,

    launch: function() {

        // console.log('launch');

        var me = this;

        var artifactTypesStore = Ext.create('Ext.data.Store', {
            fields: ['name', 'type'],
            data: [
                {"name": "Portfolio Item", "type": "PortfolioItem"},
                {"name": "User Story",     "type": "HierarchicalRequirement"},
                {"name": "Defect",         "type": "Defect"},
                {"name": "Test Case",      "type": "TestCase"},
                {"name": "Task",           "type": "Task"}
            ]
        });

        me._artifactTypeCombobox = Ext.create('Ext.form.ComboBox', {
            fieldLabel:   'Choose Artifact Type',
            store:        artifactTypesStore,
            queryMode:    'local',
            displayField: 'name',
            valueField:   'type',
            listeners: {
                scope: this,
                'select': me._getUserInfo
            }
        });

        me.down("#controlsContainer").add(me._artifactTypeCombobox);

    },

    _getUserInfo: function() {

        // console.log('_getUserInfo');

        var me = this;

        // Get currently logged-in user
        me._currentUser = this.getContext().getUser();
        me._currentUserName = me._currentUser._refObjectName;

        // Only build users cache once.
        if (me._usersByUserOID === null) {

            me._usersByUserOID = {};

            // First let's build a cache of UserNames by User ObjectID so we
            // can hydrate a friendly username onto the lookback data
            // (which contains only User OIDs)

            me.setLoading("Building Cache of Users...");

            var userStore = Ext.create('Rally.data.wsapi.Store', {
                model: 'User',
                fetch: true,
                autoLoad: true,
                limit: Infinity,
                filters: [
                    {
                        property: 'UserName',
                        operator: 'contains',
                        value: '@'
                    }
                ],
                listeners: {
                    load: function(store, data, success) {
                        Ext.Array.each(data, function(record){
                            var userOID = record.get('ObjectID');
                            me._usersByUserOID[userOID.toString()] = record;
                        });

                        // Now go get Story Data from Lookback
                        // Query for story snapshot 0's
                        me._getArtifactZeroSnapshots();
                    }
                }
            });
        } else {
            // Now go get Story Data from Lookback
            // Query for story snapshot 0's
            me._getArtifactZeroSnapshots();
        }
    },

    _getArtifactZeroSnapshots: function() {

        // console.log('_getArtifactZeroSnapshots');

        var me = this;
        me.setLoading("Retrieving Artifacts...");
        me._selectedArtifactType = me._artifactTypeCombobox.getValue();

        var currentUserOID = me._currentUser.ObjectID;
        var currentProjectOID = parseInt(me.getContext().getProjectRef().match(/\d+/), 10);

        this._snapshotStore = Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad : true,
            limit: Infinity,
            listeners: {
                load: this._processSnapShotZeroData,
                scope : this
            },
            fetch: ['ObjectID','Name','_User','FormattedID'],
            hydrate: ['FormattedID','_User'],
            removeUnauthorizedSnapshots : true,
            context: {
                workspace: me.getContext().getWorkspaceRef(),
                project: me.getContext().getProjectRef(),
                projectScopeUp: me.getContext().getProjectScopeUp(),
                projectScopeDown: me.getContext().getProjectScopeDown()
            },
            filters: [
                {
                    property: '_TypeHierarchy',
                    operator: 'in',
                    value: [me._selectedArtifactType]
                },
                {
                    property: '_ProjectHierarchy',
                    value: currentProjectOID
                },
                // Note - by grabbing Snapshot zero - we may be including stories that have been
                // deleted!
                {
                    property: '_SnapshotNumber',
                    value: 0
                }
            ]
        });
    },

    _processSnapShotZeroData : function(store, data, success) {

        // console.log('_processSnapShotZeroData');

        var me = this;

        Ext.Array.each(data, function(record) {
            var creationDateTime = me._nicerDateString(record.get('_ValidFrom'));
            var userOID = record.get('_User');
            var artifactOID = record.get('ObjectID').toString();
            var userHydrated = me._usersByUserOID[userOID.toString()];

            var storyCreator;
            if (userHydrated) {
                var userName = userHydrated.get("UserName");
                var displayName = userHydrated.get("DisplayName");

                if (displayName !== "") {
                    artifactCreator = displayName;
                } else {
                    artifactCreator = userName;
                }
            } else {
                artifactCreator = "Unknown/Deleted User";
            }
            me._artifactCreatorsByArtifactOID[artifactOID] = artifactCreator;
        });

        me._getArtifactCurrentSnapshots();
    },

    _getArtifactCurrentSnapshots: function() {

        // console.log('_getArtifactCurrentSnapshots');

        var me = this;

        var currentUserOID = me._currentUser.ObjectID;
        var currentProjectOID = parseInt(me.getContext().getProjectRef().match(/\d+/), 10);

        this._snapshotStore = Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad : true,
            limit: Infinity,
            listeners: {
                load: this._processCurrentSnapShotData,
                scope : this
            },
            fetch: ['ObjectID','Name','_User','FormattedID'],
            hydrate: ['FormattedID','_User'],
            removeUnauthorizedSnapshots : true,
            context: {
                workspace: me.getContext().getWorkspaceRef(),
                project: me.getContext().getProjectRef(),
                projectScopeUp: me.getContext().getProjectScopeUp(),
                projectScopeDown: me.getContext().getProjectScopeDown()
            },
            filters: [
                {
                    property: '_TypeHierarchy',
                    operator: 'in',
                    value: [me._selectedArtifactType]
                },
                {
                    property: '_ProjectHierarchy',
                    value: currentProjectOID
                },
                {
                    property: '__At',
                    value: 'current'
                }
            ]
        });
    },

    _processCurrentSnapShotData : function(store, data, success) {

        // console.log('_processCurrentSnapShotData');

        var me = this;
        records = [];

        Ext.Array.each(data, function(record) {
            var creationDateTime = me._nicerDateString(record.get('_ValidFrom'));
            var userOID = record.get('_User');
            var artifactOID = record.get('ObjectID').toString();
            var artifactCreator = me._artifactCreatorsByArtifactOID[artifactOID];

            var newRecord = {
                "_ref"          : me._selectedArtifactType + "/" + record.get('ObjectID'),
                "FormattedID"   : record.get('FormattedID'),
                "ObjectID"      : record.get('ObjectID'),
                "Name"          : record.get('Name'),
                "CreationDate"  : creationDateTime,
                "UserOID"       : record.get('_User'),
                "Creator"       : artifactCreator
            };
            records.push(newRecord);
        });

        me._artifactRecords = records;
        me._makeGrid();
    },

    _sortArrays: function(arr, sortArr) {

        // console.log('_sortArrays');

        var result = [];
        for(var i=0; i < arr.length; i++) {
            result[i] = arr[sortArr[i]];
        }
        return result;
    },

    _stringArrayToIntArray: function(stringArray) {

        // console.log('_stringArrayToIntArray');

        var result = [];
        Ext.Array.each(stringArray, function(thisString) {
            result.push(parseInt(thisString, 10));
        });
        return result;
    },

    _makeGrid : function() {

        // console.log('_makeGrid');

        var me = this;

        if (me._artifactGrid) {
            me._artifactGrid.destroy();
        }

        me.setLoading(false);

        var gridStore = Ext.create('Rally.data.custom.Store', {
            data: me._artifactRecords,
            groupField: 'Creator',
            pageSize: 200,
            remoteSort: false
        });

        me._artifactGrid = Ext.create('Rally.ui.grid.Grid', {
            itemId: 'artifactGrid',
            store: gridStore,
            features: [
                {
                    ftype:'groupingsummary',
                    startCollapsed: true
                }
            ],
            columnCfgs: [
                {
                    text: 'Created By', dataIndex: 'Creator'
                },
                {
                    text: 'Formatted ID', dataIndex: 'FormattedID', xtype: 'templatecolumn',
                    tpl: Ext.create('Rally.ui.renderer.template.FormattedIDTemplate')
                },
                {
                    text: 'Name', dataIndex: 'Name', flex: 1
                },
                {
                    text: 'Date Created', dataIndex: 'CreationDate', flex: 1
                }
            ]
        });

        me.down('#gridContainer').add(me._artifactGrid);
        me._artifactGrid.reconfigure(gridStore);

    },

    _nicerDateString: function(datestring) {

        // console.log('_nicerDateString');

        return datestring.replace(/T/," ").replace(/Z/, " UTC");

    },

    _noArtifactsNotify: function() {

        // console.log('_noArtifactsNotify');

        if (this._artifactGrid) {
            this._artifactGrid.destroy();
        }

        me.setLoading(false);

        this._artifactGrid = this.down('#gridContainer').add({
            xtype: 'container',
            html: "No Artifacts found."
        });
    }

});