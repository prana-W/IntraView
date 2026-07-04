import {useState} from 'react';
import useApi from '@/hooks/useApi';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {toast} from 'sonner';
import {Moon, Sun, Loader2} from 'lucide-react';
import {useTheme} from '@/components/theme-provider.jsx';

const Test = () => {
    const api = useApi();
    const {theme, setTheme} = useTheme();

    // GET state
    const [getEndpoint, setGetEndpoint] = useState('/check-health');
    const [getResponse, setGetResponse] = useState(null);

    // POST state
    const [postEndpoint, setPostEndpoint] = useState('/users');
    const [postBody, setPostBody] = useState(
        '{\n  "name": "John Doe",\n  "email": "john@example.com"\n}'
    );
    const [postResponse, setPostResponse] = useState(null);

    // PUT state
    const [putEndpoint, setPutEndpoint] = useState('/users/123');
    const [putBody, setPutBody] = useState(
        '{\n  "name": "Jane Doe",\n  "email": "jane@example.com"\n}'
    );
    const [putResponse, setPutResponse] = useState(null);

    // DELETE state
    const [deleteEndpoint, setDeleteEndpoint] = useState('/users/123');
    const [deleteResponse, setDeleteResponse] = useState(null);

    const handleGet = async () => {
        try {
            const {data, success: status, message} = await api.get(getEndpoint);

            setGetResponse(() => ({
                data: data,
                status: status,
            }));

            toast.success(message);
        } catch (err) {
            toast.error(err?.message || err);
        }
    };

    const handlePost = async () => {
        try {
            const body = JSON.parse(postBody);
            const {data, success, message} = await api.post(postEndpoint, body);
            setPostResponse({data, success});
            toast.success(message);
        } catch (err) {
            toast.error(err?.message || err);
        }
    };

    const handlePut = async () => {
        try {
            const body = JSON.parse(putBody);
            const {data, success, message} = await api.put(putEndpoint, body);
            setPutResponse({data, success});
            toast.success(message);
        } catch (err) {
            toast.error(err?.message || err);
        }
    };

    const handleDelete = async () => {
        try {
            const {data, success, message} = await api.delete(deleteEndpoint);
            setDeleteResponse({data, success});
            toast.success(message);
        } catch (err) {
            toast.error(err?.message || err);
        }
    };

    return (
        <div className="min-h-screen bg-background p-8">
            <div className="max-w-6xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-4xl font-bold">
                            API Testing Dashboard
                        </h1>
                        <p className="text-muted-foreground mt-2">
                            Test all your API endpoints in one place
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() =>
                            setTheme(theme === 'dark' ? 'light' : 'dark')
                        }
                    >
                        {theme === 'dark' ? (
                            <Sun className="h-5 w-5" />
                        ) : (
                            <Moon className="h-5 w-5" />
                        )}
                    </Button>
                </div>

                <Tabs defaultValue="get" className="w-full">
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="get">GET</TabsTrigger>
                        <TabsTrigger value="post">POST</TabsTrigger>
                        <TabsTrigger value="put">PUT</TabsTrigger>
                        <TabsTrigger value="delete">DELETE</TabsTrigger>
                    </TabsList>

                    {/* GET Tab */}
                    <TabsContent value="get">
                        <Card>
                            <CardHeader>
                                <CardTitle>GET Request</CardTitle>
                                <CardDescription>
                                    Fetch data from your API
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="get-endpoint">
                                        Endpoint
                                    </Label>
                                    <Input
                                        id="get-endpoint"
                                        placeholder="/api/endpoint"
                                        value={getEndpoint}
                                        onChange={(e) =>
                                            setGetEndpoint(e.target.value)
                                        }
                                    />
                                </div>
                                <Button
                                    onClick={handleGet}
                                    disabled={api.loading}
                                >
                                    {api.loading ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : null}
                                    Send GET Request
                                </Button>
                                {getResponse && (
                                    <div className="space-y-2">
                                        <Label>
                                            Response (Status:{' '}
                                            {getResponse?.status})
                                        </Label>
                                        <Textarea
                                            value={JSON.stringify(
                                                getResponse?.data,
                                                null,
                                                2
                                            )}
                                            readOnly
                                            className="font-mono text-sm h-64"
                                        />
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* POST Tab */}
                    <TabsContent value="post">
                        <Card>
                            <CardHeader>
                                <CardTitle>POST Request</CardTitle>
                                <CardDescription>
                                    Create new data on your API
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="post-endpoint">
                                        Endpoint
                                    </Label>
                                    <Input
                                        id="post-endpoint"
                                        placeholder="/api/endpoint"
                                        value={postEndpoint}
                                        onChange={(e) =>
                                            setPostEndpoint(e.target.value)
                                        }
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="post-body">
                                        Request Body (JSON)
                                    </Label>
                                    <Textarea
                                        id="post-body"
                                        placeholder='{"key": "value"}'
                                        value={postBody}
                                        onChange={(e) =>
                                            setPostBody(e.target.value)
                                        }
                                        className="font-mono text-sm h-32"
                                    />
                                </div>
                                <Button
                                    onClick={handlePost}
                                    disabled={api.loading}
                                >
                                    {api.loading ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : null}
                                    Send POST Request
                                </Button>
                                {postResponse && (
                                    <div className="space-y-2">
                                        <Label>
                                            Response (Status:{' '}
                                            {postResponse.status})
                                        </Label>
                                        <Textarea
                                            value={JSON.stringify(
                                                postResponse.data,
                                                null,
                                                2
                                            )}
                                            readOnly
                                            className="font-mono text-sm h-64"
                                        />
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* PUT Tab */}
                    <TabsContent value="put">
                        <Card>
                            <CardHeader>
                                <CardTitle>PUT Request</CardTitle>
                                <CardDescription>
                                    Update existing data on your API
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="put-endpoint">
                                        Endpoint
                                    </Label>
                                    <Input
                                        id="put-endpoint"
                                        placeholder="/api/endpoint/123"
                                        value={putEndpoint}
                                        onChange={(e) =>
                                            setPutEndpoint(e.target.value)
                                        }
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="put-body">
                                        Request Body (JSON)
                                    </Label>
                                    <Textarea
                                        id="put-body"
                                        placeholder='{"key": "value"}'
                                        value={putBody}
                                        onChange={(e) =>
                                            setPutBody(e.target.value)
                                        }
                                        className="font-mono text-sm h-32"
                                    />
                                </div>
                                <Button
                                    onClick={handlePut}
                                    disabled={api.loading}
                                >
                                    {api.loading ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : null}
                                    Send PUT Request
                                </Button>
                                {putResponse && (
                                    <div className="space-y-2">
                                        <Label>
                                            Response (Status:{' '}
                                            {putResponse.status})
                                        </Label>
                                        <Textarea
                                            value={JSON.stringify(
                                                putResponse.data,
                                                null,
                                                2
                                            )}
                                            readOnly
                                            className="font-mono text-sm h-64"
                                        />
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* DELETE Tab */}
                    <TabsContent value="delete">
                        <Card>
                            <CardHeader>
                                <CardTitle>DELETE Request</CardTitle>
                                <CardDescription>
                                    Remove data from your API
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="delete-endpoint">
                                        Endpoint
                                    </Label>
                                    <Input
                                        id="delete-endpoint"
                                        placeholder="/api/endpoint/123"
                                        value={deleteEndpoint}
                                        onChange={(e) =>
                                            setDeleteEndpoint(e.target.value)
                                        }
                                    />
                                </div>
                                <Button
                                    onClick={handleDelete}
                                    disabled={api.loading}
                                    variant="destructive"
                                >
                                    {api.loading ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : null}
                                    Send DELETE Request
                                </Button>
                                {deleteResponse && (
                                    <div className="space-y-2">
                                        <Label>
                                            Response (Status:{' '}
                                            {deleteResponse.status})
                                        </Label>
                                        <Textarea
                                            value={JSON.stringify(
                                                deleteResponse.data,
                                                null,
                                                2
                                            )}
                                            readOnly
                                            className="font-mono text-sm h-64"
                                        />
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
};

export default Test;
